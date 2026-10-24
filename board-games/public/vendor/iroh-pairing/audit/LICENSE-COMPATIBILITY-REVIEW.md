# VPL and EUPL compatibility review

Reviewed 2026-10-23. This is a source-and-build review, not a
legal opinion or a change to the owner's selected license. No publication occurs.

## Findings

The original first-party code currently uses the unchanged VPL. The modified
magic-wormhole 0.8.1 crate uses EUPL-1.2, and Cargo links it into the mailbox WASM
wrapper with LTO. The browser coordinates that module with the Iroh module.
The archive retains the modified crate, notices, change record and build sources.

- [Official VPL](https://viralpubliclicense.org/VPL.txt): its scope expressly
  includes dependencies and combinations, while clause 2 prohibits further
  restrictions. Its author describes an intentionally broad copyleft effect in
  [Notes on the VPL](https://blog.remilia.org/viral-public-license/).
- [Official EUPL-1.2](https://interoperable-europe.ec.europa.eu/sites/default/files/custom-page/attachment/2020-03/EUPL-1.2%20EN.txt):
  Articles 3 and 5 preserve source availability, notices, dated modifications and
  reciprocal licensing. Its compatibility appendix does not list VPL.
- [The Commission's interoperability guidance](https://interoperable-europe.ec.europa.eu/collection/eupl/licence-compatibility-permissivity-reciprocity-and-interoperability)
  distinguishes independent interoperating programs from modifications/extensions.
  Linking alone is not sufficient evidence that EUPL covers every other component.
  Absence from the appendix is not a blanket ban on using separate programs together.

The remaining issue is the interaction between VPL's broad terms and the retained
third-party obligations, plus the classification of this modified component and
wrapper. No source found establishes VPL compatibility for this build. This is an
unresolved interpretation, not a definitive finding that every VPL/EUPL combination
is prohibited. Splitting files, adding an iframe or using a separate archive does
not by itself settle either question. The author's VPL choice cannot remove rights
or obligations belonging to upstream contributors.

Replacing only Wormhole would not automatically settle the broader VPL question:
other dependency licenses also impose notice and other conditions. Rewriting the
pairing/cryptography stack solely to avoid this review would add implementation and
security work. No replacement or upstream relicensing is proposed here.

## Owner decision — keep VPL-only

The owner explicitly chose **keep VPL-only; leave combined publication on hold**
on 2026-10-23. The alternative below was reviewed and declined. Do not implement
it or request the same choice again without new information. Technical testing
continues locally. The compatibility review is completed with an unresolved
distribution issue; publication is deliberately held, not awaiting a reply.

### Considered alternative — not applied

The shortest implementation route is an additional standard license choice for
the owner's original code. It preserves VPL as an option while letting this
combined distribution use EUPL-1.2, with each dependency retaining its own terms.
It does not replace the dependency notice/source review or certify legal compliance.

The exact proposed first-party declaration is:

> Original first-party code authored for this standalone connection tool is
> available, at the recipient's choice, under the Viral Public License OR the
> European Union Public Licence version 1.2. This choice covers only code whose
> rights the project owner controls. Third-party code, including modifications
> to the vendored magic-wormhole library, retains its applicable licenses and
> notices. The combined distribution uses the EUPL-1.2 alternative for original
> first-party code and preserves each dependency's applicable terms.

This declaration is a proposal only. LICENSE and the current package still use
VPL for original code. No custom exception or dual licensing takes effect unless
the owner explicitly chooses it. If VPL-only remains the decision, keep the
combined package unpublished pending qualified compatibility confirmation or
appropriate rights-holder permission. Local technical testing can continue.

## Completed and remaining

- [x] Compare primary license texts, official interoperability guidance and the build boundary.
- [x] Preserve source, upstream terms and the exact selected VPL text.
- [x] Prepare a concrete alternative without applying it or changing runtime code.
- [x] Obtain the owner's choice: VPL-only, with combined publication held.
- [ ] Publication hold: establish a valid VPL-only distribution route through
  qualified compatibility confirmation or appropriate rights-holder permission.
  The declined dual-license proposal is not an active implementation task.
