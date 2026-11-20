async function refreshStockPreview() {
  const caption = document.querySelector('#stock-preview');
  try {
    const response = await fetch(DEFAULT_CRM_API + '?view=shift', {cache: 'no-store'});
    const stock = await response.json();
    if (!Number.isFinite(stock.physical) || !Number.isFinite(stock.available)) throw Error();
    caption.textContent = 'На точке: ' + stock.physical + ' шт. · Доступно: ' + stock.available + ' шт.';
  } catch {
    caption.textContent = 'Не удалось обновить остаток';
  }
}
document.querySelector('#reload-preview').onclick = refreshStockPreview;
window.addEventListener('focus', refreshStockPreview);
refreshStockPreview();
