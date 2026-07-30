@echo off
REM Convenience wrapper so you can type "pal <command>" in this folder.
REM Examples:  pal status   |   pal broadcast Hello_all   |   pal rcon ShowPlayers   |   pal --help
"%~dp0pal.exe" %*
