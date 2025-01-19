// PERMANENT CONTEXT RULES - MUST BE CHECKED BEFORE ANY OPERATION
// ==================================================================
// This file MUST be consulted before ANY operation on the codebase.
// These rules are BINDING and PERMANENT for all interactions.
// ==================================================================

SNEED MUD - Technical Specifications
================================

This directory contains detailed technical specifications for various systems and mechanics in SNEED MUD.

IMPORTANT: SPECIFICATION ENFORCEMENT RULES
----------------------------------------
1. These specification files are LAW. They represent the definitive, authoritative design of all systems.

2. ALL code changes MUST strictly adhere to these specifications. No exceptions.

3. Before ANY code modification:
   - The relevant specification MUST be consulted
   - ALL referenced documents MUST be reviewed (see below)
   - The proposed changes MUST be verified against the specification
   - If any conflict exists between proposed changes and the spec, the spec wins

4. Specification Changes:
   - Specifications can ONLY be modified with explicit user consent
   - ANY desired spec changes MUST first be:
     a) Clearly described
     b) Justified with specific reasons
     c) Accompanied by clarifying questions if needed
   - Spec changes MUST be handled as separate, isolated steps
   - No code changes that would violate current specs may be made until spec changes are approved

5. Violation of these rules is strictly forbidden. When in doubt, assume the spec is correct.


This directory contains detailed technical specifications for various systems and mechanics in SNEED MUD.

Referenced Documents
------------------
The following documents MUST be consulted alongside any specification:
1. ASSUMPTIONS.txt - Core technical constraints and their impacts
[Additional reference documents will be added as needed]

Files:
- Combat.txt: Details the combat system mechanics, timings, and formulas
- (Additional spec files will be added as systems are documented)

Purpose:
These specifications serve as the authoritative reference for how game systems should work. They should be consulted when implementing new features or modifying existing ones to ensure consistency with the intended design.


Format:
Each specification file follows a standard format:
1. Overview
2. Key Components
3. Detailed Mechanics
4. Constants & Formulas
5. Edge Cases & Restrictions 