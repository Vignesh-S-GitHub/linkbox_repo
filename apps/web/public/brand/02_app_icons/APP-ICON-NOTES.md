# Installed-app icon correction

Only the PWA and Apple home-screen icons change. The website's original full logo, wordmark, favicons and all supplied brand-kit exports remain untouched.

The built-in image editing tool used the complete `01_logo/png/linkbox-logo-full-transparent.png` as its edit target because the standalone symbol/app-icon exports clip the cloud sides and bottom box point. The final image was exported at 180, 192 and 512 pixels; no new runtime or CI imaging dependency was added.

Project assets:

- `linkbox-app-v2-180.png`: Apple touch icon.
- `linkbox-app-v2-192.png`: regular and maskable app icon.
- `linkbox-app-v2-512.png`: regular and maskable app icon.

Versioned filenames avoid reuse of the earlier cropped files. The service-worker build hashes these assets. Tests decode the PNG pixels, verify opaque RGB output and centering, and confirm all colored artwork stays inside the central circle with radius 40% of the canvas width. This follows [maskable-icon guidance](https://web.dev/articles/maskable-icon).

## Image-tool prompt

Use case: compositing. Edit target: attached exact original LinkBox logo artwork. Produce one square 1024x1024 app icon. Extract ONLY the complete blue cloud/open-box/white-chain symbol from above the lettering. Remove the lettering entirely. Preserve the exact existing symbol shape, proportions, blue gradients, white chain, two small blue accent strokes, complete cloud lobes and complete bottom box point. Do not redraw, restyle or redesign any of these. Change only canvas placement and padding. Center the complete symbol horizontally and vertically on an opaque solid pure white (#FFFFFF) square background. The symbol must fit inside a centered 560 by 560 pixel bounding square (around 55% of the canvas width/height) with generous equal white margins, so it is wholly safe inside a circular launcher mask. Full symbol visible, nothing cropped, no cut-off corners, no text, no border, no extra shadow, no other objects. This is a faithful copy/resize/composite of supplied branding, not a new logo design.

The tool returned a 1254px square master. The final exports have approximately 73–74% artwork bounds, but the complete silhouette still fits inside the specified circular safe area, confirmed by the pixel regression tests. The tool's requested numeric bounding-square dimensions were not treated as proof of safety.
