// A .fixboi file contains a magic header, a little-endian manifest length, the JSON manifest,
// and the optional source model bytes. Keep new manifest fields optional for older projects.
const PROJECT_FILE_TYPE = 'application/octet-stream';
const PROJECT_MAGIC = 'FIXBOI1\n';
const PROJECT_HEADER_SIZE = PROJECT_MAGIC.length + 4;
const PROJECT_MAX_MANIFEST = 16 * 1024 * 1024;
const PROJECT_EXTENSION = /\.fixboi$/i;
const PROJECT_MODEL_EXTENSION = /\.(3dm|obj)$/i;

function projectIdentifier() {
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, '0')).join('');
}

const validSavedPoint = (point) => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
const validSavedCamera = (camera) => Number.isFinite(camera?.az) && Number.isFinite(camera.el) &&
  Number.isFinite(camera.halfWidth) && camera.halfWidth > 0 && Number.isFinite(camera.halfHeight) && camera.halfHeight > 0 &&
  validSavedPoint(camera.target);

// Keep the source bytes as their own Blob part so saving does not encode a large Rhino file in JSON.
function makeDrawingProject(id, state, modelFile) {
  const source = modelFile
    ? { type: 'file', name: modelFile.name, lastModified: modelFile.lastModified, size: modelFile.size }
    : { type: 'optics-sample' };
  const manifest = new TextEncoder().encode(JSON.stringify({ id, source, ...state }));
  if (manifest.length > PROJECT_MAX_MANIFEST) throw Error('The project settings are too large to save.');
  const header = new ArrayBuffer(PROJECT_HEADER_SIZE);
  new Uint8Array(header).set(new TextEncoder().encode(PROJECT_MAGIC));
  new DataView(header).setUint32(PROJECT_MAGIC.length, manifest.length, true);
  const parts = [header, manifest];
  if (modelFile) parts.push(modelFile);
  return new Blob(parts, { type: PROJECT_FILE_TYPE });
}

async function readDrawingProject(file) {
  const header = await file.slice(0, PROJECT_HEADER_SIZE).arrayBuffer();
  const decoder = new TextDecoder();
  if (header.byteLength !== PROJECT_HEADER_SIZE || decoder.decode(header.slice(0, PROJECT_MAGIC.length)) !== PROJECT_MAGIC)
    throw Error('This file is not a supported Drawing Studio project.');
  const length = new DataView(header).getUint32(PROJECT_MAGIC.length, true);
  const payload = PROJECT_HEADER_SIZE + length;
  if (!length || length > PROJECT_MAX_MANIFEST || payload > file.size)
    throw Error('The project settings are incomplete or too large.');
  const manifest = JSON.parse(decoder.decode(await file.slice(PROJECT_HEADER_SIZE, payload).arrayBuffer()));
  const { source, drawings, id } = manifest ?? {};
  if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id) || !Array.isArray(drawings?.working?.settings?.planes) ||
      !Array.isArray(drawings?.views)) throw Error('The project does not contain a working sheet and saved view list.');
  if (source?.type === 'optics-sample' && payload === file.size) return { ...manifest, modelFile: null };
  if (source?.type !== 'file' || typeof source.name !== 'string' || !PROJECT_MODEL_EXTENSION.test(source.name) ||
      !source.size || source.size !== file.size - payload) throw Error('The project’s source model is missing or incomplete.');
  const lastModified = Number.isFinite(source.lastModified) ? source.lastModified : 0;
  const modelFile = new File([file.slice(payload)], source.name, { lastModified });
  return { ...manifest, modelFile };
}
