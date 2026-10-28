/**
 * classifier-bridge.js — Compatibility bridge
 * 
 * Maps the legacy Classifier interface to the new ClassificationService.
 * Drop-in replacement for classifier.js that uses deterministic routing.
 */
import { classifyIntent, classifyCategories, CATEGORIES } from '../services/classification.js';

export class Classifier {
  constructor() {
    // No Gemini client needed — deterministic classification
  }

  /**
* @param {{ description: any; title: any; }} aide
*/
  async classify(aide) {
    const textToClassify = aide.description || aide.title || '';
    const result = classifyIntent(textToClassify);
    return {
      category: result.categories[0] || 'EMPLOI',
      confidence: result.confidence,
      method: result.method,
      allCategories: result.categories
    };
  }
}

export { CATEGORIES };
