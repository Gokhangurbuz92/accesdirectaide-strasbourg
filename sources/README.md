# Data Sources Manifest

## Overview

This directory contains the configuration for all external data sources used by the platform.

## Files

- **manifest.json**: Main configuration file listing all data sources
- **manifest-schema.json**: JSON Schema for validation
- **README.md**: This file

## Adding a New Source

1. Edit `manifest.json`
2. Add a new entry to the `sources` array with the following fields:

### Required Fields

- `id`: Unique identifier (kebab-case, e.g., `service-public-aides`)
- `label`: Human-readable name
- `scope`: Geographic scope (`national`, `67`, `68`)
- `type`: Content type (`aide`, `demarche`, `structure`, `dispositif`)
- `url_exact`: **Exact URL** to fetch (must be specific, not just homepage)

### Recommended Fields

- `base_url`: Base URL of the source
- `strategy`: Ingestion strategy (`api`, `scrape`, `rss`, `manual`)
- `license`: Data license (e.g., `Open License 2.0`)
- `trust_level`: Trust level (`OFFICIAL`, `VERIFIED`, `COMMUNITY`)
- `enabled`: Whether this source is active (`true` or `false`)
- `notes`: Additional notes or configuration details

## Validation

Before committing changes, validate the manifest:

```bash
node scripts/validate-sources-manifest.js
```

The validator checks:
- Required fields are present
- IDs are unique and properly formatted (kebab-case)
- URLs are valid and not duplicated
- URLs are specific (not just homepages)
- Scope and type values are valid
- No duplicate sources

## Example Entry

```json
{
  "id": "service-public-aides",
  "label": "Service-Public.fr - Aides aux particuliers",
  "scope": "national",
  "type": "aide",
  "base_url": "https://www.service-public.fr",
  "url_exact": "https://www.service-public.fr/particuliers/vosdroits/N19775",
  "strategy": "scrape",
  "license": "Open License 2.0",
  "trust_level": "OFFICIAL",
  "enabled": true,
  "notes": "Official French government portal for citizen services"
}
```

## Important Rules

1. **url_exact must be specific**: Don't use just the homepage. Point to the exact page/API endpoint containing the data.
2. **IDs must be unique**: Each source must have a unique ID.
3. **Use kebab-case for IDs**: e.g., `my-source-name`, not `MySourceName` or `my_source_name`.
4. **Validate before committing**: Always run the validator before committing changes.
5. **Start with enabled: false**: For new sources, set `enabled: false` until the ingestion pipeline is configured and tested.

## Integration with Pipeline

The ingestion pipeline (see `api/_handlers/cron/`) reads this manifest to:
1. Create/update `DataSource` records in the database
2. Configure ingestion jobs
3. Track source metadata and trust levels

## Next Steps

After adding a source to the manifest:
1. Implement the ingestion logic in the pipeline
2. Test the ingestion with `enabled: false` first
3. Verify data quality and completeness
4. Set `enabled: true` to activate
5. Monitor sync runs in the `SyncRun` table
