# The App is signed by SignPath Foundation

The App ships unsigned for the betas (ADR-0020, ADR-0023). On Windows, Smart App Control asks Microsoft's cloud about each new unsigned program, and blocks it when the cloud cannot tell that it is safe. There is no "Run anyway": the person must turn Smart App Control off for the whole machine. Everyone else sees SmartScreen's "Windows protected your PC" first. Every version is a new file, so the cloud decides again for each one, the App's own updates included. FirstMate 2.0 is for other people on Windows, so 2.0.0 final ships signed.

SignPath Foundation signs the App. It signs open-source projects for free, on SignPath's own hardware, and FirstMate meets its terms: an OSI licence (MIT), public source on GitHub, free downloads, and builds in public CI. The certificate is SignPath Foundation's, so Windows names "SignPath Foundation" as the signer, not the maintainer. The README's code signing policy says who commits, who reviews and who approves, as SignPath Foundation's terms ask. The application and the project setup in SignPath are issue #156; the workflow is issue #188.

This is not live yet. The release workflow signs only when the SignPath settings are present: the organization, the project and the signing policy as repository variables, and the API token as a secret (#191). Until then, the same workflow ships an unsigned beta, and a version that is not a prerelease refuses to publish unsigned.

## Where the key is

No signing key is in this repository or in a GitHub secret. The key stays on SignPath's hardware. The one secret signing needs is a SignPath API token, which can only ask for a signature: SignPath signs nothing until the maintainer approves the request on SignPath's site. A leaked token signs nothing by itself.

## What is signed, and in which order

Smart App Control checks `FirstMate.exe` and every other `.exe` and `.dll` when the App starts. An installer signed around unsigned program files still installs an App that is blocked. So the Windows App is packaged in two passes, with a signature after each:

1. Package the unpacked App, with the fuses written. Writing a fuse changes `FirstMate.exe`, so it comes before the signature. The `RunAsNode` fuse stays on, because every Plugin Server runs on `FirstMate.exe` as Node (ADR-0019, ADR-0020).
2. Sign every `.exe` and `.dll` of the unpacked App. Electron ships two of them, `d3dcompiler_47.dll` and `dxil.dll`, signed by Microsoft already, and they keep that signature. The installer carries no `elevate.exe`, which electron-builder would copy in only while it builds the installer, after this signature: only an install for every user needs it, and the App installs for one user.
3. Build the NSIS installer from the signed, unpacked App.
4. Sign the installer.
5. Write the update feed, `latest.yml`, and the installer's block map from the installer as it is after the last signature.

A signature changes a file's bytes, so a feed written before it names a SHA-512 and a size that no longer match, and electron-updater refuses the update. The feed is written last for that reason. The `.sha256` beside the installer is already written from the bytes the Release carries, and no file changes its name (ADR-0023).

SignPath reads two artifact configurations, `app` and `installer`. The copies SignPath is given are kept in `apps/desktop/signpath/`, and `app` names each program file it signs. A new program file in a new Electron is named nowhere, so it reaches the check below unsigned, and the release fails instead of shipping it.

After signing, the workflow checks that every `.exe` and `.dll` and the installer carry a valid signature, that the `RunAsNode` fuse still reads on, and that `latest.yml` matches the installer. Each failure names the file, and nothing is published.

The AppImage and the deb are not signed. Smart App Control does not check them, and they keep the SHA-256 beside them.

## The publisher check stays off

electron-updater can check that an update is signed by the same publisher as the App that installs it (`publisherName`). It stays off.

The signer is "SignPath Foundation", the same name on every project SignPath Foundation signs, so the check proves only that some project it signs made the file. And if FirstMate ever moves to a certificate of its own, the name changes, and every App that checks would refuse that update: each person would have to reinstall by hand. The check stays what it is: the SHA-512 in `latest.yml`, read over HTTPS from the GitHub Release of the tag.

## Considered Options

Azure Artifact Signing (Trusted Signing). It has paused onboarding of individual developers, and it takes new organizations only from the US and Canada with three years of history. FirstMate is neither.

A certificate bought from a certificate authority. It costs about US$200–400 a year, after an identity check, on a hardware token or a cloud key. A hardware token cannot sign on a CI runner, and a cloud key is one more secret to keep.

The installer alone, signed. It is one signing request, but Smart App Control would still block the unsigned `FirstMate.exe` it installs.

The publisher check on. It is the reasons above: it proves little with a shared signer name, and it locks the App to that name.

## Consequences

Each release needs two manual approvals on SignPath's site: the unpacked App first, then the installer. The workflow waits long enough for both, and sends no signing request for a tag that fails the check.

The pull request artifact, `FirstMate-Setup`, and the local `package` script stay unsigned and send nothing to SignPath. Only a tag signs.

Windows names SignPath Foundation as the signer, not FirstMate or its maintainer.

The NSIS uninstaller, `Uninstall FirstMate.exe`, stays unsigned. electron-builder writes it inside the installer pass and signs it only through its own signing, which a release does not use, and SignPath cannot open an NSIS installer to sign what is inside it. Smart App Control may block an uninstall. This is open (#192). One fix keeps two approvals: a sign hook in electron-builder sets the uninstaller aside in a first installer pass, the uninstaller goes to SignPath with the unpacked App, and the hook puts the signed one back in a second installer pass.

SignPath Foundation is asked whether it signs Electron's own `.dll` files, since Electron is not FirstMate's code. Smart App Control checks them too.

ADR-0020 and ADR-0023 say the betas are unsigned. They stay as they are until a signed version ships, and then they say how the App is signed.
