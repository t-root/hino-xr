# AR Space Scanner (`space-scanner`)

Reconstructs a 3D spatial wireframe mesh and detects high-contrast visual anchor points directly from the camera stream (`FramePacket`), fused with 3DoF orientation tracking (`deviceorientation`).

## Design
- **Visual-Inertial Spatial Mesh:** Samples a 20x14 grid from the live camera frame, combines spatial gradient magnitude with vertical perspective floor estimation, and temporal-filters the depth field (`0.72` history, `0.28` current frame).
- **Stereo Synchronisation:** Uses a single offscreen Three.js WebGLRenderer mirrored to both eyes via `CanvasMirror`, driven by Core's `frameClock`, and stores all UI/anchor state in `SharedState`.
- **Hand & Two-Hand AR Interaction:**
  - Single-hand pinch & drag on an anchor moves and rotates the 3D hologram in world space.
  - Two-hand pinch (`twohand` event) scales and twists the selected 3D hologram in mid-air.
  - "Place Block" drops a new 3D hologram directly along the wearer's current heading and pitch vector.
