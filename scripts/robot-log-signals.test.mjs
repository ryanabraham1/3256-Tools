// Run with: node --experimental-strip-types --test scripts/robot-log-signals.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, estimateTotalCurrent, currentBreakdown, parsePowerMapping } from '../lib/robot-logs/core/analysis.ts';

const names = ['NT:/DriveState/Timestamp', '/Vision/Camera0/poseObservations/0/timestamp', '/Shooter/shooterMotorSupplyCurrents/0', '/Drive/StatorCurrent', '/PDH/TotalCurrent', '/Custom/Load', '/Intake/Amps'];
const channels = names.map(name => ({name, type: 'double', samples: [{time: 0, value: 36}, {time: 10, value: 36}]}));
const recording = {name: 'regression', duration: 10, channels, warnings: []};

test('timestamps and stator/total current never enter automatic device ranking', () => {
  assert.deepEqual(currentBreakdown(recording).map(c => c.channel), [names[2], names[6]]);
  assert.equal(currentBreakdown(recording)[0].mAh, 100);
});
test('explicit mapping overrides detection, including an empty allowlist', () => {
  const mapping = parsePowerMapping({current: names[4], deviceCurrents: [names[5], names[4]]}, channels);
  assert.deepEqual(currentBreakdown(recording, mapping.current, 24, mapping.deviceCurrents).map(c => c.channel), [names[5]]);
  assert.deepEqual(currentBreakdown(recording, undefined, 24, []), []);
  assert.deepEqual(parsePowerMapping(JSON.parse(JSON.stringify(mapping)), channels), mapping);
});
test('mapping validation rejects missing signals, type mismatches and misspelled roles', () => {
  assert.throws(() => parsePowerMapping({deviceCurrents: ['missing']}, channels), /Signal not found/);
  assert.throws(() => parsePowerMapping({brownout: names[0]}, channels), /Wrong signal type/);
  assert.throws(() => parsePowerMapping({deviceCurrents: 'bad'}), /must be an array/);
  assert.throws(() => parsePowerMapping({currents: []}), /Unknown mapping field/);
});

const stream = (name, values) => ({name, type: 'double', samples: values.map(([time,value]) => ({time,value}))});
const log = channels => ({name: 'sum', duration: 10, warnings: [], channels});
test('sums simultaneous loads rather than individual peaks and integrates estimated power', () => {
  const r = log([
    stream('/BatteryVoltage', [[0,12],[10,12]]),
    stream('/A/SupplyCurrent', [[0,100],[5,0],[10,0]]),
    stream('/B/SupplyCurrent', [[0,0],[5,100],[10,100]]),
  ]);
  const result = analyze(r);
  assert.equal(result.power.currentSource, 'estimated');
  assert.equal(result.power.peakCurrent, 100);
  assert.equal(result.power.averagePower, 1200);
  assert.ok(Math.abs(result.power.energyWh - 12000/3600) < 1e-9);
  assert.deepEqual(result.power.currentChannels, ['/A/SupplyCurrent','/B/SupplyCurrent']);
});
test('holds asynchronous samples only within the common span', () => {
  const r = log([
    stream('/A/SupplyCurrent', [[0,10],[3,20],[8,30]]),
    stream('/B/SupplyCurrent', [[2,5],[4,15],[10,25]]),
  ]);
  assert.deepEqual(estimateTotalCurrent(r, {}).channel.samples, [
    {time:2,value:15},{time:3,value:25},{time:4,value:35},{time:8,value:45}
  ]);
  const disjoint = log([stream('/A/SupplyCurrent', [[0,10],[1,10]]),stream('/B/SupplyCurrent', [[2,20],[3,20]])]);
  assert.equal(estimateTotalCurrent(disjoint, {}), undefined);
});
test('prefers measured totals, avoids overlapping PDH sources and duplicate NT mirrors', () => {
  const r = log([
    stream('/A/SupplyCurrent', [[0,10],[10,10]]),
    stream('NT:/A/SupplyCurrent', [[0,10],[10,10]]),
    stream('/PDH/ChannelCurrents/0', [[0,10],[10,10]]),
  ]);
  assert.equal(analyze(r).power.peakCurrent, 10);
  r.channels.push(stream('/PDH/TotalCurrent', [[0,42],[10,42]]));
  assert.equal(analyze(r).power.currentSource, 'measured');
  assert.equal(analyze(r).power.peakCurrent, 42);
  assert.equal(analyze(r).estimatedCurrent, undefined);
  assert.equal(analyze(log(r.channels.slice(0,3)), {deviceCurrents: []}).power.peakCurrent, undefined);
});
test('uses every mapped device rather than the 24-row ranking limit', () => {
  const r = log(Array.from({length:30}, (_,i) => stream(`/Motor${i}/SupplyCurrent`, [[0,2],[10,2]])));
  assert.equal(analyze(r).power.peakCurrent, 60);
  assert.equal(analyze(log([stream('/Motor/StatorCurrent', [[0,100],[10,100]])])).power.currentSource, undefined);
});
