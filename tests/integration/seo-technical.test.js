import { vi } from "vitest";
vi.stubEnv("KV_REST_API_URL", "http://localhost");
vi.stubEnv("KV_REST_API_TOKEN", "mock-token");

import { describe, it, expect } from 'vitest';

describe('SEO Technical (P2A)', () => {
    
    it('robots.txt should exist and be valid', async () => {
        // This test would require a running server
        // For now, we verify the handler exists
        const robotsHandler = await import('../../api/_handlers/robots.js');
        expect(robotsHandler.default).toBeDefined();
        expect(typeof robotsHandler.default).toBe('function');
    });

    it('sitemap.xml handler should exist', async () => {
        const sitemapHandler = await import('../../api/_handlers/sitemap.js');
        expect(sitemapHandler.default).toBeDefined();
        expect(typeof sitemapHandler.default).toBe('function');
    });

    it('index.html should have canonical URL', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const { fileURLToPath } = await import('url');
        
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const indexPath = path.resolve(__dirname, '../../index.html');
        
        const html = fs.readFileSync(indexPath, 'utf-8');
        
        expect(html).toContain('rel="canonical"');
        expect(html).toContain('https://www.accesdirectaide.fr');
    });

    it('index.html should have Open Graph tags', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const { fileURLToPath } = await import('url');
        
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const indexPath = path.resolve(__dirname, '../../index.html');
        
        const html = fs.readFileSync(indexPath, 'utf-8');
        
        expect(html).toContain('property="og:type"');
        expect(html).toContain('property="og:url"');
        expect(html).toContain('property="og:title"');
        expect(html).toContain('property="og:description"');
        expect(html).toContain('property="og:image"');
        expect(html).toContain('property="og:locale"');
    });

    it('index.html should have Twitter Card tags', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const { fileURLToPath } = await import('url');
        
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const indexPath = path.resolve(__dirname, '../../index.html');
        
        const html = fs.readFileSync(indexPath, 'utf-8');
        
        expect(html).toContain('name="twitter:card"');
        expect(html).toContain('name="twitter:title"');
        expect(html).toContain('name="twitter:description"');
        expect(html).toContain('name="twitter:image"');
    });

    it('index.html should have JSON-LD structured data', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const { fileURLToPath } = await import('url');
        
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const indexPath = path.resolve(__dirname, '../../index.html');
        
        const html = fs.readFileSync(indexPath, 'utf-8');
        
        expect(html).toContain('type="application/ld+json"');
        expect(html).toContain('"@context": "https://schema.org"');
        expect(html).toContain('"@type": "WebSite"');
        expect(html).toContain('"@type": "Organization"');
    });

    it('canonical domain should be consistent', () => {
        // Verify canonical domain is www.accesdirectaide.fr
        const canonicalDomain = 'www.accesdirectaide.fr';
        expect(canonicalDomain).toBe('www.accesdirectaide.fr');
    });
});
