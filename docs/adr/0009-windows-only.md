# kyle-hub is Windows-only

_Superseded for the terminal module by [ADR-0013](0013-macos-terminals.md)._

kyle-tickets is already Windows-only; kyle-term's macOS paths were only unit-tested. They are dropped during migration rather than carried untested. node-pty stays in the helper process (kyle-term ADR-0001), and the xterm canvas-font build patch carries over.
