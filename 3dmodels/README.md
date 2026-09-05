# 3D Building Explorer

A Three.js/Vite prototype based on the uploaded building reference image.

## Included
- Procedural 3D building with 4 floors and 3 selectable units per floor
- Floor X-ray focus: selected floor stays visible while other levels, roof and context fade to transparent ghosts
- Unit selection and metadata panel
- Search by unit ID (101-403)
- Status visualization: available / occupied / maintenance
- Exploded floor view
- Top-down floor-plan mode
- Orbit, zoom and pan controls
- Responsive glass-style UI
- Uploaded reference image included as `public/building-reference.webp`

## Run

```bash
npm install
npm run dev
```

Then open the local Vite URL.

## Notes

The model is generated procedurally from the supplied reference image, so it is intentionally editable rather than a single baked mesh. This makes each floor/unit independently addressable from application data.

For a production version, the procedural geometry can be replaced or augmented with a `.glb`/`.gltf` asset while keeping the same selection/data architecture.
