/* MOLINE CRM. Pure event reducer shared by Apps Script and Node tests.
   Money is stored as integer kopecks. Quantity is rounded to 0.001 units. */
var CRMCore = (function () {
  function check(ok, message) { if (!ok) throw new Error(message); }
  function money(value) { check(value !== '' && value != null && Number.isFinite(Number(value)), 'Некорректная сумма'); return Math.round(Number(value) * 100); }
  function qty(value) { check(value !== '' && value != null && Number.isFinite(Number(value)), 'Некорректное количество'); return Math.round(Number(value) * 1000) / 1000; }
  function initial() { return { sales: {}, shifts: {}, stock: {}, payments: [], movements: [], events: [] }; }
  function key(location, product) { return location + ':' + product; }
  function movement(s, e, product, amount, reason, location) {
    location = location || e.location_id;
    var k = key(location, product); s.stock[k] = qty((s.stock[k] || 0) + amount);
    s.movements.push({event_id:e.event_id,location_id:location,product_id:product,qty:amount,reason:reason,created_at:e.created_at});
  }
  function pay(s, e, sale, shift, method, amount) {
    s.payments.push({event_id:e.event_id,sale_id:sale,shift_id:shift,method:method,amount:amount,created_at:e.created_at});
    if (s.sales[sale]) s.sales[sale].paid += amount;
  }
  function reduce(events) {
    var s = initial(); events.forEach(function(e) {
      var d=e.payload, sale, sh;
      if(e.type==='shift.open') s.shifts[d.id]={id:d.id,location_id:e.location_id,employee_id:e.actor_id,opened_at:e.created_at,closed_at:'',opening_cash:d.opening_cash,status:'open'};
      if(e.type==='shift.close') { sh=s.shifts[d.shift_id]; check(sh,'Смена не найдена'); Object.assign(sh,{closed_at:e.created_at,actual_cash:d.actual_cash,expected_cash:d.expected_cash,difference:d.actual_cash-d.expected_cash,status:'closed'}); }
      if(e.type==='sale.create') {
        sale={id:d.id,created_at:e.created_at,shift_id:d.shift_id,location_id:e.location_id,employee_id:e.actor_id,partner_id:d.partner_id||'',lines:d.lines,total:d.total,paid:0,status:'sold',fiscal_status:'not_integrated'};
        s.sales[d.id]=sale;
        d.lines.forEach(function(l){if(l.stock_tracked)movement(s,e,l.product_id,-l.qty,'sale');});
        if(d.payment)pay(s,e,d.id,d.shift_id,d.payment.method,d.payment.amount);
      }
      if(e.type==='payment.add') pay(s,e,d.sale_id,d.shift_id,d.method,d.amount);
      if(e.type==='sale.refund') {
        sale=s.sales[d.sale_id]; check(sale,'Продажа не найдена'); sale.status='refunded';
        if(d.restock)sale.lines.forEach(function(l){if(l.stock_tracked)movement(s,e,l.product_id,l.qty,'refund');});
        d.payments.forEach(function(p){pay(s,e,d.sale_id,d.shift_id,p.method,-p.amount);});
      }
      if(e.type.indexOf('stock.')===0) {
        movement(s,e,d.product_id,d.delta,e.type+(d.reason?': '+d.reason:''));
        if(e.type==='stock.transfer')movement(s,e,d.product_id,-d.delta,e.type,d.to_location);
      }
      s.events.push(e);
    }); return s;
  }
  function expectedCash(s, shiftId) {
    var shift=s.shifts[shiftId]; check(shift,'Смена не найдена');
    return shift.opening_cash+s.payments.filter(function(p){return p.shift_id===shiftId&&p.method==='cash';}).reduce(function(a,p){return a+p.amount;},0)+s.events.filter(function(e){return (e.type==='cash.in'||e.type==='cash.out')&&e.payload.shift_id===shiftId;}).reduce(function(a,e){return a+e.payload.amount*(e.type==='cash.in'?1:-1);},0);
  }
  function report(s, location, from, to) {
    var inRange=function(date){var day=new Date(new Date(date).getTime()+10800000).toISOString().slice(0,10);return day>=from&&day<=to;};
    var events=s.events.filter(function(e){return (!location||e.location_id===location)&&inRange(e.created_at);});
    var sales=events.filter(function(e){return e.type==='sale.create';});
    var returns=events.filter(function(e){return e.type==='sale.refund';});
    var receipts=s.payments.filter(function(p){var sh=s.shifts[p.shift_id];return sh&&(!location||sh.location_id===location)&&inRange(p.created_at);});
    var gross=sales.reduce(function(a,e){return a+e.payload.total;},0), refunded=returns.reduce(function(a,e){return a+s.sales[e.payload.sale_id].total;},0);
    return {from:from,to:to,gross:gross,refunds:refunded,revenue:gross-refunded,sale_count:sales.length,refund_count:returns.length,receipts:receipts.reduce(function(a,p){return a+p.amount;},0),cash:receipts.filter(function(p){return p.method==='cash';}).reduce(function(a,p){return a+p.amount;},0),debt:Object.values(s.sales).filter(function(x){return x.status==='sold'&&(!location||x.location_id===location);}).reduce(function(a,x){return a+x.total-x.paid;},0),writeoffs:events.filter(function(e){return e.type==='stock.writeoff';}).length};
  }
  return {check:check,money:money,qty:qty,key:key,reduce:reduce,expectedCash:expectedCash,report:report};
})();
if(typeof module!=='undefined')module.exports=CRMCore;
