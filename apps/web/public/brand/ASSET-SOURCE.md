# Asset provenance

Original files supplied by the user from:
https://github.com/Vignesh-S-GitHub/linkbox_repo/tree/main/LinkBox-Brand-Assets

Downloaded unchanged from commit `6c29288378f63a257a2416402155bc8612903f11`.
PNG logos are used instead of SVG reconstructions to preserve the reference artwork.
UI icons, browser icons, app icons, design tokens, and references are kept in their original directories.

The wordmark PNG includes part of the box symbol above its lettering. `Brand.tsx`
and the `.brand-wordmark-frame` styles crop that stray area for compact headers;
the original PNG is unchanged. Settings, folder, storage and play glyphs are
code-native SVGs in `BrandIcon.tsx`, adjusted to the rendered reference because
the supplied outline SVG placeholders differ from it. Other action icons still
use the supplied files. File folders use yellow artwork; navigation folders use
the blue accent. Light is the default appearance, with a subtle white/blue wash.

Dark appearance adds a clipped, white-filtered copy of the original lettering
over only the navy "Link" glyphs. "Box" and the cloud retain their original
colors. Both compact and full logos use this treatment, including System mode
when the OS prefers dark. The original assets and light-mode rendering are unchanged.

Compact symbols now display the complete cloud/box region of the original full
logo PNG with a little breathing room, because the standalone symbol export
clips the cloud sides and box point. Document previews retain the original
lettering colors on white paper, regardless of the app theme. See `UI_REVIEW.md`
for the scope and results of browser verification.

The app-specific manifest at `/site.webmanifest` points to these bundled app icons.
Reference mockups are design materials, not replacement screenshots of the running app.
