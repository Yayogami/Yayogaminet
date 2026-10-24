# Standalone tool licensing

The original first-party code authored for this standalone connection tool is
licensed under the **Viral Public License (VPL)** in `LICENSE`. The project owner
selected VPL on 2026-10-23.

The license text is from <https://viralpubliclicense.org/VPL.txt>. It is reproduced
without an added exception, dual license or modified terms. VPL seeks to waive
ownership, attribution and copyrights, and applies broad continuity requirements
to copying, dependencies, linkage and other combinations. This differs from the
earlier explanation of EUPL; that explanation was not a description of VPL.

## Scope and existing material

This declaration concerns the tool's original first-party code in this directory.
Third-party material retains its existing licenses and notices. In particular:

- The modified `tests/wormhole-wasm/vendor/magic-wormhole` crate, including its
  existing modifications, remains under its EUPL-1.2 terms.
- Other vendored/downloaded sources, toolchains, dependencies and their notices
  are not relicensed. Generated bindings and compiled modules incorporate material
  whose applicable licenses must be considered together; they are not declared
  VPL-only by this file.
- The dependency inventory and source archive preserve the relevant upstream
  notices. Historical audit snapshots are not changed retroactively.
- The website and game projects are outside this declaration; no files or license
  choices in those projects are changed here.

These statements identify authorship and scope. They do not add an exception to
VPL, remove an upstream obligation, or establish compatibility between licenses.

## Combined distribution remains unresolved

The current build combines first-party VPL code with an EUPL-1.2 Wormhole
component. VPL requires retention of its entire text for broad combinations and
disallows further restrictions. EUPL Articles 3 and 5 require source availability,
notices and reciprocal licensing; VPL is not in its compatible-license appendix.
See the [official EUPL text](https://interoperable-europe.ec.europa.eu/sites/default/files/custom-page/attachment/2020-03/EUPL-1.2%20EN.txt).

Reading those terms together raises a possible compatibility conflict. Official
EUPL guidance distinguishes independent interoperating programs from derivatives;
linking alone or absence from the appendix does not settle that classification.
No legal clearance
for this combined distribution is claimed. Keeping separate license files is not
proof that the conflict is resolved. The local package remains an unpublished
review candidate until a valid distribution route is established, such as confirmed
compatibility, appropriate rightsholder permission, or replacement of conflicting
components. Review must also cover the remaining dependency licenses.

No dependency replacement, relicensing exception or alternative license has been
selected by this change. Runtime behavior and networking policy are unchanged.

The owner explicitly reaffirmed VPL-only on 2026-10-23 and chose to leave combined
publication on hold. The completed text/build review and declined dual-license
proposal are recorded in [the compatibility review](audit/LICENSE-COMPATIBILITY-REVIEW.md).
This is a deliberate publication hold; independent local tests may continue.
