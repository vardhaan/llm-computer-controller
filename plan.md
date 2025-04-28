# AI Launcher Implementation Plan - MVP Focus

## Phase 1: ✓ Project Setup
- ✓ Basic Electron + React + TypeScript setup
- ✓ Simple menubar app shell
- ✓ Basic overlay window

## Phase 2: ✓ Core System Bridge
- ✓ Set up ContextBridge security layer
- ✓ Implement core system operations (via IPC):
  - ✓ List applications
  - ✓ Open files/apps
  - ✓ Search files
- Add SQLite caching for performance
- ✓ Create TypeScript interfaces for all operations

## Phase 3: ✓ UI Integration
- ✓ Wire up input field to system bridge
- ✓ Add results display component (using VStack/Box workaround)
- ✓ Implement global hotkey (⇧⌘Space)
- Basic error handling and feedback [Deferred]
- ✓ Theme management with next-themes
- ✓ Launch at login
- ✓ Show window on system resume

## Phase 4: LLM Integration [CURRENT]
- OpenAI integration with function calling
- Define tool schemas for system operations
- Basic prompt template
- Response parsing and action execution

## MVP Success Criteria
- Can launch apps and open files via natural language
- All operations complete within 3s
- Basic error feedback
- Stable and reliable core functions

## Technical Decisions
1. ✓ **Framework**: Electron for quick MVP
2. ✓ **System Access**: ContextBridge + Node.js APIs (faster, simpler)
3. **Storage**: SQLite for caching
4. **Security**: Minimal privilege escalation, typed IPC

## Security Minimum
- Restricted system API exposure through ContextBridge
- Basic path validation
- Required permissions only
- Transparent command execution

## Post-MVP Features (Backlog)
- AppleScript/Swift helpers for advanced app control
- Plugin system for power users
- Performance optimizations
- Analytics and logging
- Auto-updates 