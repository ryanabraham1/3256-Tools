import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, imports = {}) {
  const mod = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: (n) => imports[n] });
  return mod.exports;
}
const { matchMaterial, stockDimsForModel, typedThickness } = load('lib/parts.ts', { './units': load('lib/units.ts') });

const IN = 25.4;
const sheet = (id, wall) => ({ id, material: '6061 Al', shape: 'sheet', wall_mm: wall * IN, archived: false });
const rack = [sheet('quarter', 1 / 4), sheet('eighth', 1 / 8)];
// an Onshape plate modeled at 1/4" that the team moved to 1/8" in the tracker
const plate = { kind: 'plate', material_text: 'Aluminum Sheet', size_l_mm: 200, size_w_mm: 100, size_t_mm: 6.35 };

test('a plate thickness typed in Stock / dims picks the sheet over the model', () => {
  assert.equal(matchMaterial({ ...plate, stock_dims: '1/8" thick' }, rack)?.id, 'eighth');
  assert.equal(matchMaterial({ ...plate, stock_dims: '1/4" thick' }, rack)?.id, 'quarter');
  assert.equal(matchMaterial({ ...plate, stock_dims: '' }, rack)?.id, 'quarter');
  assert.equal(matchMaterial(plate, rack)?.id, 'quarter');
  // no 1/8" sheet on the rack: no match, not the model's 1/4"
  assert.equal(matchMaterial({ ...plate, stock_dims: '1/8" thick' }, [rack[0]]), null);
  assert.ok(Math.abs(typedThickness('1/8" thick') - 3.175) < 1e-6);
  assert.equal(typedThickness('1/2 diam shaft'), null);
});

test('an Onshape re-import keeps a typed thickness but follows a model that changed', () => {
  // typed over the model: stays
  assert.equal(stockDimsForModel({ stock_dims: '1/8" thick', size_t_mm: 6.35 }, 6.35), '1/8" thick');
  // only ever repeated the model, and the model went to 1/8": follows it
  assert.equal(stockDimsForModel({ stock_dims: '1/4" thick', size_t_mm: 6.35 }, 3.175), '1/8" thick');
  // model unchanged: untouched
  assert.equal(stockDimsForModel({ stock_dims: '1/4" thick', size_t_mm: 6.35 }, 6.35), '1/4" thick');
  assert.equal(stockDimsForModel({ stock_dims: '', size_t_mm: 6.35 }, 3.175), '');
});
