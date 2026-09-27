import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileProducts, applyReconciliationDecision, invoiceBrandConflict } from './lib/commerce/product-reconciliation.ts';
const group = (groupKey, name, brand, unitCount, images = [{sourceIndex:0,role:'Frente'},{sourceIndex:1,role:'Atrás'}]) => ({groupKey,name,brand,unitCount,images,visibleIdentifiers:[{value:'code',type:'code_128',sourceIndex:1}]});
const line = (id, description, quantity, keys, brand = null) => ({id,line_number:1,description,brand,quantity,unit_price:100,matched_group_keys:keys});
const action = (groups, lines, decisions, kind, groupKey, lineId, quantity=1, amount) => applyReconciliationDecision({groups,lines,decisions,kind,groupKey,lineId,quantity,amount,id:String(decisions.length),actorId:'admin',now:'2026-09-27'});
test('case 1: missing front is never synthesized from a back photo', () => {
  const g=group('s','Cable Samsung','Samsung',1,[{sourceIndex:1,role:'Atrás'}]);
  const p=reconcileProducts([g],[line('a','Cable Samsung',1,['s'])]).products[0];
  assert.deepEqual(p.missingImages,['front']); assert.equal(p.extra,0);
});
test('case 2: a code value without its owned photo is missing QR evidence', () => {
  const g=group('s','Cable Samsung','Samsung',1);g.visibleIdentifiers[0].sourceIndex=99;
  assert.deepEqual(reconcileProducts([g],[]).products[0].missingImages,['code']);
});
test('required other image is separate from QR', () => {
  const g={...group('s','Samsung','Samsung',1),requiredImageRoles:['front','back','code','other']};
  assert.deepEqual(reconcileProducts([g],[]).products[0].missingImages,['other']);
});
test('case 3: fifth joystick stays with its article and requires confirmation', () => {
  const groups=[group('j','Joystick PS4','Sony',5)], lines=[line('a','Joystick PS4',4,['j'])];
  let r=reconcileProducts(groups,lines);assert.equal(r.products[0].extra,1);assert.equal(r.pending,1);
  const decisions=action(groups,lines,[],'review','j');r=reconcileProducts(groups,lines,decisions);
  assert.equal(r.pending,0);assert.equal(r.totals.physical,5);assert.equal(lines[0].quantity,4);
});
test('case 4: Motorola +1 crosses Samsung -1 only after confirmation; value is conserved', () => {
  const groups=[group('s','Cable Samsung USB-C','Samsung',2),group('m','Cable Motorola USB-C','Motorola',1)];
  const lines=[line('a','Cable Samsung TC',3,['s'],'Samsung')];
  let r=reconcileProducts(groups,lines);assert.equal(r.lines[0].deficit,1);assert.equal(r.products[1].candidates[0].suggested,true);
  assert.equal(r.products[1].allocations.length,0);
  const decisions=action(groups,lines,[],'reassign','m','a');r=reconcileProducts(groups,lines,decisions);
  assert.deepEqual(r.products.map(p=>p.expected),[2,1]);assert.equal(r.totals.extra,0);assert.equal(r.totals.shortage,0);
  assert.equal(r.products.flatMap(p=>p.allocations).reduce((sum,a)=>sum+a.quantity*100,0),300);
  assert.equal(lines[0].quantity,3);assert.equal(groups[0].unitCount,2);
});
test('conflicting legacy AI match is unlinked and becomes a suggestion', () => {
  const groups=[group('s','Cable Samsung USB-C','Samsung',2),group('m','Cable Motorola USB-C','Motorola',1)];
  const r=reconcileProducts(groups,[line('a','Cable Samsung TC',3,['s','m'],'Samsung')]);
  assert.equal(r.products[1].expected,0);assert.equal(r.lines[0].deficit,1);
  assert.equal(invoiceBrandConflict({description:'Cable TC Samsung'},groups[1]),true);
});
test('case 5: a gift does not consume an invoice line or invent a cost', () => {
  const groups=[group('s','Cable Samsung','Samsung',3),group('m','Cable Motorola','Motorola',1)];
  const lines=[line('a','Cable Samsung',3,['s'],'Samsung')];
  let r=reconcileProducts(groups,lines);assert.equal(r.products[1].candidates[0].suggested,false);
  assert.throws(()=>action(groups,lines,[],'extra','m',undefined,1),/valor del extra/);
  const decisions=action(groups,lines,[],'extra','m',undefined,1,5500);r=reconcileProducts(groups,lines,decisions);
  assert.equal(r.pending,0);assert.equal(r.products[1].unbilled,1);assert.equal(r.products[1].unbilledValue,5500);assert.equal(r.products[1].allocations.length,0);
  assert.equal(r.products[0].expected,3);assert.equal(lines[0].unit_price,100);
});
test('manual charged elsewhere with no deficit exposes donor overage', () => {
  const groups=[group('s','Cable Samsung','Samsung',3),group('m','Cable Motorola','Motorola',1)];
  const lines=[line('a','Cable Samsung',3,['s'],'Samsung')];
  const decisions=action(groups,lines,[],'reassign','m','a');const r=reconcileProducts(groups,lines,decisions);
  assert.equal(r.products[0].extra,1);assert.equal(r.products[0].pending,true);
});
test('multiple extras cannot consume the same missing unit twice', () => {
  const groups=[group('s','Cable Samsung','Samsung',2),group('m','Cable Motorola','Motorola',1),group('x','Cable Apple','Apple',1)];
  const lines=[line('a','Cable Samsung',3,['s'],'Samsung')];
  const decisions=action(groups,lines,[],'reassign','m','a');const r=reconcileProducts(groups,lines,decisions);
  assert.equal(r.products[2].candidates[0].suggested,false);
  assert.throws(()=>action(groups,lines,decisions,'reassign','m','a'),/reasignación/);
});
test('repeated invoice lines do not double count a physical group', () => {
  const r=reconcileProducts([group('s','Cable Samsung','Samsung',3)],[line('a','Cable Samsung',2,['s']),line('b','Cable Samsung',2,['s'])]);
  assert.equal(r.totals.shortage,1);assert.equal(r.products[0].expected,4);
  assert.equal(r.products[0].allocations.reduce((sum,a)=>sum+a.quantity,0),3);
});
test('count changes invalidate old decisions, evidence enrichment preserves allocations', () => {
  const groups=[group('s','Cable Samsung','Samsung',2),group('m','Cable Motorola','Motorola',1)],lines=[line('a','Cable Samsung',3,['s'])];
  const decisions=action(groups,lines,[],'reassign','m','a');groups[1].images.push({sourceIndex:5,role:'Detalle'});
  assert.equal(reconcileProducts(groups,lines,decisions).products[1].expected,1);
  groups[0].unitCount=3;const r=reconcileProducts(groups,lines,decisions);assert.equal(r.staleDecisions,1);assert.equal(r.products[1].expected,0);
});
