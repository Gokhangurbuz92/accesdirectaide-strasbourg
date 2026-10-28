// @ts-nocheck
/**
 * falc-bridge.js — Compatibility bridge
 * 
 * Maps the legacy FalcWriter interface to FalcSpecialist via BaseSpecialist.
 */
import { FALC_DEFINITION } from './falc.js';
import { BaseSpecialist } from './base-specialist.js';
import { createDispatch } from './dispatch.js';

export class FalcWriter {
  constructor() {
    this.specialist = new BaseSpecialist(FALC_DEFINITION);
  }

  /**
* @param {{ description: any; title: any; }} aide
*/
  async simplify(aide) {
    const text = aide.description || aide.title || '';
    const dispatch = createDispatch({
      userIntent: 'FALC',
      sourceComponent: 'falc-bridge',
      targetComponent: 'falc',
      payload: text,
      timeoutMs: 45_000
    });
    const response = await this.specialist.execute(dispatch);
    return {
      simplifiedText: response.content?.simplifiedText || '',
      title: response.content?.simplifiedTitle || '',
      keyActions: response.content?.keyActions || [],
      reviewStatus: 'PENDING'
    };
  }
}
