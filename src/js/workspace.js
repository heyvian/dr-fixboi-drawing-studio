// Keep the inspector's selected panel and its keyboard tab stop in sync in both workspaces.
function selectInspectorTab(tab, focus = false) {
  for (const item of tab.parentElement.querySelectorAll('[role="tab"]')) {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
    $(item.getAttribute('aria-controls')).hidden = !selected;
  }
  if (focus) tab.focus();
}

function bindWorkspaceTabs(list, select = selectInspectorTab) {
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  for (const tab of tabs) tab.onclick = () => select(tab);
  list.onkeydown = (event) => {
    const index = tabs.indexOf(event.target);
    if (index < 0) return;
    const vertical = list.getAttribute('aria-orientation') === 'vertical';
    const destination = {
      [vertical ? 'ArrowUp' : 'ArrowLeft']: mod(index - 1, tabs.length),
      [vertical ? 'ArrowDown' : 'ArrowRight']: mod(index + 1, tabs.length),
      Home: 0, End: tabs.length - 1
    }[event.key];
    if (destination === undefined) return;
    event.preventDefault();
    select(tabs[destination], true);
  };
}

for (const list of document.querySelectorAll('.inspector-tabs')) bindWorkspaceTabs(list);
