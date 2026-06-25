# Change Log

All notable changes to the "Env Sync" extension will be documented in this file.

## [0.1.0] - 2026-06-25

### Added
- Initial release
- Multi-language scanner supporting JavaScript/TypeScript, Python, Java, Ruby, Rust, and Go
- `Generate .env.example` command — scans workspace and creates documentation file
- `Validate .env against .env.example` command — finds missing/extra variables
- `Show Missing/Extra Variables` command — compares code usage against documented vars
- `Scan Current File` command — quick scan of active editor
- 55 unit tests covering scanner logic (100% pass rate)
- Configurable output file, excluded directories, scan extensions, and comment inclusion
