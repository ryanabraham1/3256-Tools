# Robot log signal mapping

In Logs → Power → Signal mapping → Agent / custom signal mapping, download the
signal catalog. It contains exact channel names and types, plus the current mapping.
Give it to an agent together with the robot's logging code or signal documentation.
Channel values alone cannot establish physical units or meaning.

Paste the agent's **mapping object** into the editor and select Apply mapping:

```json
{
  "voltage": "/Power/BatteryVoltage",
  "current": "/Power/TotalCurrent",
  "brownout": "/Robot/BrownedOut",
  "deviceCurrents": ["/Shooter/SupplyCurrent", "/Intake/SupplyCurrent"]
}
```

Use actual names from the catalog. Voltage must be in volts and currents in amperes.
The brownout channel must be boolean; the other channels must be numeric. Unknown
fields, missing channels and incorrect types are rejected without replacing the
active mapping. Omit voltage/current/brownout when unavailable.

`deviceCurrents` is an authoritative allowlist for Biggest current draws. An empty
array disables that ranking. Omit it to use conservative name-based detection.
Include battery-side supply current or PDH/PDP branch current, exclude stator
current, targets, limits, timestamps and vision data. Do not list both a motor's
supply current and its PDH channel if that would duplicate the same device. The
mapped total current is always excluded from this ranking.

Mappings apply to the open recording and are saved by recording hash in this
browser. They do not change the log or teammates' settings. Reset to automatic
detection restores the default name-based roles. Export the catalog to share a mapping with
another person or agent. The site does not call an AI model automatically.

## Estimated total current

When no usable measured total is mapped, the analyzer sums simultaneous logged
supply-current readings. Automatic mode prefers motor supply currents; if none
exist it uses recognized PDH/PDP branch-current channels. It never automatically
mixes these sources, and it collapses exact `NT:` mirrors of the same path.
An explicit `deviceCurrents` list overrides that source selection. Select a single
measurement per physical load; the analyzer cannot infer every device alias.
Generic current or amps signals require explicit mapping to enter the estimate.

The sum holds each reading until its next update, over the common recorded span
of all selected signals. Peak draw comes from that summed waveform, not the sum
of individual motor peaks. It includes all selected devices, regardless of the
ranking's 24-row display limit. Voltage and the estimated current waveform also
provide estimated energy and average power over their shared span. A recorded
total always takes priority. An empty `deviceCurrents` list disables estimation.

All derived totals, power and energy are labeled estimated. Unlogged motors,
computers and other electronics are omitted; this is not a complete battery
measurement. Stator current alone is not battery supply current and is not used
for automatic estimates.
