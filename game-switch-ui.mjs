import { horseTrackOptions, isValidHorseRaceSelection } from './race-logic.mjs';

export function mountGameSwitch(client, document = globalThis.document, confirm = globalThis.confirm) {
  const $ = id => document.getElementById(id);
  const names = { alag: 'Алаг мэлхий', horse: 'Морь уралдуулах' };
  function showSelectionError(message = '') {
    let error = $('switch-error');
    if (!error) {
      error = document.createElement('p');
      error.id = 'switch-error';
      error.setAttribute('role', 'alert');
      $('switch-dialog').append(error);
    }
    error.textContent = message;
  }
  function populateDistance(categoryId, selectedLength) {
    const select = $('switch-distance');
    const placeholder = document.createElement('option');
    placeholder.textContent = 'Замын зайг сонгоно уу'; placeholder.value = '';
    select.replaceChildren(placeholder);
    for (const option of horseTrackOptions(categoryId)) {
      const item = document.createElement('option');
      item.textContent = `${option.kilometers} км · ${option.trackLength} шагай`;
      item.value = String(option.trackLength); select.add(item);
    }
    select.value = selectedLength == null ? '' : String(selectedLength);
  }
  function updateFields() {
    const horse = $('switch-target').value === 'horse';
    $('switch-length-label').hidden = horse;
    $('switch-length').hidden = horse;
    $('switch-category-label').hidden = !horse;
    $('switch-category').hidden = !horse;
    $('switch-distance-label').hidden = !horse;
    $('switch-distance').hidden = !horse;
    $('switch-length').disabled = horse;
    $('switch-category').disabled = !horse;
    $('switch-distance').disabled = !horse || !$('switch-category').value;
  }
  $('switch-game').onclick = () => {
    if (!client.canSwitch()) return;
    const settings = client.switchSettings();
    $('switch-target').value = settings.gameType === 'alag' ? 'horse' : 'alag';
    for (const option of $('switch-target').options) option.disabled = option.value === settings.gameType;
    $('switch-length').value = String(settings.alagTrackLength ?? ([12, 18, 24].includes(settings.trackLength) ? settings.trackLength : 18));
    $('switch-category').value = settings.horseCategory || '';
    populateDistance(settings.horseCategory, settings.trackLength);
    showSelectionError();
    updateFields();
    $('switch-dialog').showModal();
  };
  $('switch-target').onchange = () => { showSelectionError(); updateFields(); };
  $('switch-category').onchange = () => {
    populateDistance($('switch-category').value, null);
    showSelectionError();
    updateFields();
  };
  $('switch-cancel').onclick = () => $('switch-dialog').close();
  $('switch-confirm').onclick = () => {
    if (!client.canSwitch()) { $('switch-dialog').close(); return; }
    const from = client.switchSettings().gameType, target = $('switch-target').value;
    const trackLength = Number(target === 'horse' ? $('switch-distance').value : $('switch-length').value);
    const horseCategory = target === 'horse' ? $('switch-category').value : undefined;
    if (target === 'horse' && !isValidHorseRaceSelection(horseCategory, trackLength)) {
      showSelectionError('Насны ангилал болон замын зайг сонгоно уу.');
      return;
    }
    if (!confirm(`${names[from]} тоглоомыг дуусгаад ${names[target]} тоглоомыг шинээр эхлүүлэх үү?`)) return;
    if (client.requestSwitch(target, trackLength, horseCategory)) $('switch-dialog').close();
  };
}
