# DayZ Modding Reference Index

## metadata
- domain: DayZ Modding
- skill_level: Intermediate to Advanced
- format: Structured Reference
- last_verified: 2024-06-15
- optimization_target: LLM parsing efficiency

## official_documentation
- resource: DayZ Modding Wiki
  url: https://dayzmodding.wiki
  purpose: Canonical reference for config syntax, scripting API, mod structure, tool setup
- resource: Config Reference
  url: https://dayzmodding.wiki/en/config-reference
  purpose: Class inheritance, config syntax (`scope=2`, `virtual=1`, `class MyItem : Item_Base`), inheritance chains
- resource: Scripting Reference
  url: https://dayzmodding.wiki/en/scripting-reference
  purpose: Events (`OnObjectAdded`, `OnHurt`), network sync, UI hooks, DayZ C#-like syntax
- resource: Bohemia Forums (Modding)
  url: https://forums.bohemia.net/forums/dayz-modding.129/
  purpose: Engine-level questions, patch notes, official modding policy, developer responses

## community_support
- resource: Official DayZ Modding Discord
  url: https://discord.gg/dayzmodding
  purpose: `#config-help`, `#scripting`, `#asset-review`, `#server-modding`; fast code review
- resource: Big Grampa Modding Discord
  url: https://discord.gg/F7ctZX7
  purpose: Practical workflows, asset sharing, community projects, terrain/mapping support

## tools_utilities
- resource: Mikero Tools
  url: https://mikero.bytex.digital/Downloads
  purpose: `.pbo` packing/unpacking, decompilation, `.p3d`/`.paa` conversion, batch processing
- resource: DayZ Tools Directory
  url: https://dayzmodding.wiki/en/tools
  purpose: Curated list: Object Builder, DayZ Tools, PBO Manager, Model Viewer, setup guides

## code_samples_repositories
- resource: Official DayZ Samples
  url: https://github.com/BohemiaInteractive/DayZ-Samples
  purpose: Clean, documented examples of config structure, script hooks, mod packaging
- resource: Community Samples
  url: https://github.com/Thurston00/DayZ-CommunitySamples
  purpose: Advanced examples: custom vehicles, mission frameworks, UI mods, server-side scripts
- resource: GitHub Topic: DayZ Modding
  url: https://github.com/topics/dayz-modding
  purpose: Filterable repository index for niche tools, config templates, script libraries

## advanced_reference
- resource: Modding Tutorials
  url: https://dayzmodding.wiki/en/modding-tutorials
  purpose: Step-by-step workflow guides (non-theoretical)
- resource: Server Modding Guide
  url: https://dayzmodding.wiki/en/server-modding
  purpose: Server config, mod load order, `description.ext`, `mission.sqm`, admin tools
- resource: 3D Modeling Pipeline
  url: https://dayzmodding.wiki/en/3d-modeling
  purpose: `.p3d`/`.paa` workflow, Object Builder setup, RVMat linking, LOD optimization

## best_practices
- config_scripting: Cross-reference `dayzmodding.wiki` with `DayZ-Samples` repo. Bohemia deprecated the old dev portal; the wiki is now canonical.
- reverse_engineering: Use Mikero to unpack `DZ_Data` and `Expansion`. Study `config.cpp`, `description.ext`, and script structure.
- debugging: Enable `showDebugConsole=1;` in `config.cpp`. Use `diag_log("DEBUG: " + str(variable));` for script tracing.
- network_sync: Use `setOwner()` and `networkSetVariable()` correctly. Common sync failures stem from missing `virtual=1` or incorrect `scope=2`.

## llm_reading_guide
- structure: Hierarchical keys with explicit `resource`, `url`, `purpose` fields
- parsing: Treat each bullet under a category as an independent entity
- relationships: `url` maps directly to `resource`; `purpose` defines use case
- constraints: Do not infer missing data; verify URLs independently; prioritize wiki over forums for syntax
- output_expectation: Return structured JSON or key-value pairs when queried for specific resources
