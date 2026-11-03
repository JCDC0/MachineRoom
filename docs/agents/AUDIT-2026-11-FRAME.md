# Audit, November 2026: frame cost of music, bloom and light trails

Date: 2026-11-03
Author: AGY (Gemini 3.8 Flash)
Branch: `feat/q39-frame-cost-of`
Commit read: `7267d0ee26c7f9a0fbe644f90974239f8a34c227` (0.1.401)
Brief: Q39

## Scope

Read `src/engine/agents.js`, `src/engine/cards.js`, `src/engine/hub.js`, `src/engine/bloom.js`, `src/engine/room.js`, `src/engine/strings.js` and `src/ui/sound.js` on main at commit `7267d0e`.

The review inspects the cost of one frame when 10 agents work and music is playing with dance, vertex pulsing, bloom and light trails enabled. AGY lanes do not edit the engine; an OpenCode lane fixes what this audit lists.

## Summary

The main time sinks in a music-and-trails frame are:
1. Bloom renders the entire 3D scene a second time using a separate WebGL context.
2. Light trails add two `Line2` fat-line draw calls per working agent and per web agent.
3. Every agent shape pulses its vertices in a JavaScript CPU loop every frame, setting `needsUpdate` on each geometry buffer even for resting agents.
4. Payload packets recalculate polyline distances repeatedly in CPU math and re-upload two point-cloud buffers per agent every frame.
5. Card row state updates scan every card and row in the project when stream events arrive, instead of only active cards.
6. Lit string strands rewrite their vertex position buffer in JavaScript and set `needsUpdate` every frame.
7. Material colors and opacities are written every frame without checking if values changed.
8. Short-lived arrays, objects and sets are created every frame in the core animation loop.
9. Audio binning computes repeated logarithms for every frequency bin.

Findings are ranked below by rough cost from highest to lowest.

## Findings

| # | Rough cost | Where | How often | What costs time | Smallest fix |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | 4.0 to 10.0 ms | `src/engine/bloom.js:53-86`, `src/engine/room.js:867` | Every frame (60 fps) when bloom is on | Bloom creates a second `THREE.WebGLRenderer` and canvas. `bloom.render` calls `renderer.render(scene, camera)`, drawing the entire scene a second time into an offscreen render target before running 5 blur mip passes and a quad copy. Every draw call in the room is duplicated across two WebGL contexts. | Use a single WebGLRenderer. Use `THREE.Layers` to render only glowing objects (trails and status rings) to the bloom target, or composite bloom in the primary render pipeline. |
| 2 | 1.5 to 3.0 ms | `src/engine/agents.js:502-510, 948-958, 1473-1520` | Every frame for each working agent | Each tunnel trail builds two `Line2` objects (`core` and `sheath`), each using instanced geometry and fat-line screen-space vertex shaders. With 10 agents working, tunnels add 20 `Line2` draw calls per frame. Web beams add up to 20 more `Line2` draw calls. Bloom doubles both sets to 40-80 draw calls. | Combine core and sheath into one shader or one standard line mesh with additive blending, or draw the sheath only during close-up camera holds. |
| 3 | 1.0 to 2.5 ms | `src/engine/agents.js:678-720, 1385` | Every frame for every agent in the room | When music pulse bands are active, `applyPulse` runs for all agents (all 10+ views). It iterates over every vertex in JavaScript, multiplying X, Y and Z coordinates by a scaled factor. It then sets `attribute.needsUpdate = true` on every agent shape every frame, forcing a full `gl.bufferSubData` upload. Resting and idle agents pulse every frame too. | Skip resting and idle agents in `applyPulse`. Alternatively, displace vertices in a vertex shader with an audio band uniform array, removing CPU loops and buffer re-uploads completely. |
| 4 | 0.8 to 1.5 ms | `src/engine/agents.js:880-918, 276-321` | Every frame for each working agent | In `updatePackets`, up to 24 packets and 72 tail points call `samplePolyline` every frame. `samplePolyline` walks polyline segments calling `spanLength` (`Math.hypot`) repeatedly (up to 960 distance calls per frame for 10 agents). Then `attr.needsUpdate = true` and `tailAttr.needsUpdate = true` re-upload position buffers for both point clouds on every working agent every frame. | Precompute cumulative segment lengths on the polyline so `samplePolyline` uses a binary search without repeated hypot calls. Combine head and tail packets into one `Points` buffer, halving buffer uploads and draw calls. |
| 5 | 0.5 to 1.2 ms | `src/engine/cards.js:1086-1311` | Every frame where stream events update `latest` | When `rowsDue` is true, `cards.update` iterates over every card in the project and every row in every card, comparing file counters and updating CSS classes. Resting cards in untouched folders are scanned every time, evaluating hundreds of row DOM nodes. | Restrict the row comparison loop to cards whose paths are in `active.dirs` or `active.files`, skipping resting cards. |
| 6 | 0.4 to 0.8 ms | `src/engine/strings.js:177-196, 351-373` | Every frame for each lit folder link | `travelStrand` runs inside `mesh.onBeforeRender` for every lit link. It loops over all particle positions in CPU JavaScript, recalculates coordinates along the line, and sets `attr.needsUpdate = true` every frame. 10 agents traversing 10 to 20 links trigger 10 to 20 buffer uploads per frame. | Move strand particle phase animation into a vertex shader with a time uniform, avoiding CPU buffer writes and `needsUpdate`. |
| 7 | 0.2 to 0.5 ms | `src/engine/room.js:838-843`, `src/engine/hub.js:412-417`, `src/engine/agents.js:556-564, 1364-1371`, `src/engine/hub.js:427-432` | Every frame across 10+ agents and hub markers | In every frame, `hub.setSlot` writes `material.color.setHex` and `material.opacity` for every agent slot without checking if values changed. `trailOpacity` and `trailColor` write opacity and color on `core` and `sheath` lines every frame. Agent shape, ring and label materials are also assigned every frame without guarding against unchanged values. | Guard property assignments with an equality check before writing to material properties. |
| 8 | 0.2 to 0.4 ms | `src/engine/room.js:837`, `src/engine/agents.js:1301-1309, 84-99, 524`, `src/engine/hub.js:422-423`, `src/ui/sound.js:58-65` | Every frame (60 fps) | The frame loop allocates temporary objects and collections: `{ focus, hover }` in `room.js`, `busy` array and `{ key, since }` objects in `agents.js`, `list`, `keys`, `ranked` and `kept` in `fullCalloutKeys`, `workingSectors` Set in `hub.js`, and `.filter()` / `.slice()` in `sound.js`. These trigger periodic garbage collection pauses. | Use module-level or view-level reusable scratch arrays and sets. In `beatDetector`, compute average and deviation with index loops instead of `.filter()` and `.slice()`. |
| 9 | 0.05 to 0.1 ms | `src/ui/sound.js:8-16, 243-247` | Every 45 ms (~22 times a second) while music plays | `bandIndexForBin` computes `Math.log2(1 + bins)` 128 times on each audio sample, although `bins` is constant. | Compute `Math.log2(1 + bins)` once, or precalculate a 128-element lookup table mapping bin index to band index. |
