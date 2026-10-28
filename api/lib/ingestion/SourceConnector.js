
/**
 * Interface for Source Connectors
 */
export class SourceConnector {
    /**
* @param {any} name
*/
    constructor(name, /** @type {string | number | boolean | null | undefined} */ baseUrl) {
        this.name = name;
        this.baseUrl = baseUrl;
    }

    /**
     * Fetches the listing page(s) and returns a list of detail URLs.
     * @returns {Promise<string[]>}
     */
    async getDetailUrls() {
        throw new Error('Not implemented');
    }

    /**
   * @param {string | undefined} [url]
   */
    async fetch(url) {
        throw new Error('Not implemented');
    }

    /**
   * @param {void} html
   * @param {string | undefined} [url]
   */
    async parse(html, url) {
        throw new Error('Not implemented');
    }

    /**
* @param {any} item
*/
    getStableId(item) {
        throw new Error('Not implemented');
    }
}
