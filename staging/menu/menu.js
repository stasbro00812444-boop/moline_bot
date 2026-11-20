const label=x=>x;
function stockCaption(p){
 if(p.freeToday>0&&p.freeToday<=5)return 'Осталось мало';
 if(p.freeToday===0&&p.preorderDates?.length)return 'Предзаказ с '+p.preorderDates[0].split('-').reverse().join('.');
 return p.weight||label(p.category);
}
async function refresh(){try{const r=await fetch('https://script.google.com/macros/s/AKfycbzoz2UlD7WhmWubSob3rjBG-UfzWRI6vKj7m2Ss9Et1hRobSnqw6EXT8Wdf9iH6VvyF-A/exec?view=catalog',{cache:'no-store'}),p=await r.json();if(!Number.isFinite(p.freeToday))throw Error();document.querySelector('#stock').textContent=stockCaption({...p,category:'Выпечка'});document.querySelector('#price').textContent=p.price+' ₽';}catch{document.querySelector('#stock').textContent='Не удалось обновить меню';}}
document.querySelector('#reload').onclick=refresh;window.addEventListener('focus',refresh);refresh();