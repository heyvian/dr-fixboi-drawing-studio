function selectInspectorTab(tab, focus = false) {
  for (const item of tab.parentElement.querySelectorAll('[role="tab"]')) {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
    $(item.getAttribute('aria-controls')).hidden = !selected;
  }
  if (focus) tab.focus();
}

for (const list of document.querySelectorAll('.inspector-tabs')) {
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  for (const tab of tabs) tab.onclick = () => selectInspectorTab(tab);
  list.onkeydown = (event) => {
    const index = tabs.indexOf(event.target);
    if (index < 0) return;
    const destination = {
      ArrowLeft: mod(index - 1, tabs.length), ArrowRight: mod(index + 1, tabs.length),
      Home: 0, End: tabs.length - 1
    }[event.key];
    if (destination === undefined) return;
    event.preventDefault();
    selectInspectorTab(tabs[destination], true);
  };
}
