# Dependency Upgrade Log

**Date:** 2026-07-14 | **Project:** Loco3160/vrm | **Language:** TypeScript

## Summary

- **Updated:** 1
- **Skipped:** 0
- **Failed:** 0

## Updates

### @modelcontextprotocol/sdk: 1.17.3 → 1.29.0

- **Reason:** The inherited runtime version was affected by published high-severity advisories, including GHSA-8r9q-7v3j-jr4g and GHSA-345p-7cg4-v4c7.
- **Compatibility:** v1.29.0 is the latest stable v1 release, retains Node.js 18 support, and its release notes do not list breaking changes.
- **Tests:** 154 tests passed; TypeScript typecheck and build passed.
- **Security audit:** `npm audit --omit=dev` reports 0 production vulnerabilities.
