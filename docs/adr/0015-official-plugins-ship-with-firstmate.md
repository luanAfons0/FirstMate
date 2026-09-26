# Official Plugins ship with FirstMate

A new FirstMate has an empty Registry, and the first thing a person has to learn is where a Plugin comes from. The project already writes Plugins of its own — `worklog`, `scheduler` and `nexus` — so FirstMate offers them by name: `firstmate install worklog` fetches one, and `firstmate setup` shows the list and asks which to fetch. These are the Official Plugins.

The list is part of the package. Each entry is a Plugin Name, a git URL, one line that says what it does, and whether it calls other Plugins. The list changes when FirstMate is released, and at no other time.

An Official Plugin is installed when the Registry holds a Plugin of that name. Nothing else is checked: not the directory, not the URL it came from. Once installed it is a Plugin like any other, and the Registry does not remember that it was ever official.

## Considered Options

A list fetched from the network, from a JSON file in this repository. It would let the list change without a release, but it makes `setup` need the network before it can show anything, it is a file format that FirstMate would own and have to version, and it is one step from a Plugin index that anyone can publish into. ADR-0002 exists to keep FirstMate out of that business.

Recording what each Official Plugin needs to run — Node 24, Python 3 — so that `setup` can check it before fetching. That is a manifest written by FirstMate instead of by the Plugin, and it goes stale the day a Plugin changes its runtime. A Plugin that cannot run goes Stopped and says so on the Index Page, which is how FirstMate already tells a person that a Plugin is broken.

## Consequences

ADR-0002 stands. The list is FirstMate's own knowledge about its own Plugins, and it asks nothing of a Plugin. A Plugin that is not official is fetched by directory or URL, exactly as before.

"Whether it calls other Plugins" is the one fact on the list beyond an address. It is there so that `setup` can offer a Grant to the Plugins that need one, such as `scheduler`, instead of asking about every pair in the Registry.

A person who registered a different Plugin under an official name sees that name as installed, and `setup` does not offer it. This is accepted: the Plugin Name is the identity everywhere else in FirstMate, and a second rule for Official Plugins would be a surprise.

Adding or removing an Official Plugin is a code change and a release, reviewed like any other change.
