// O GitHub Pages executa o processamento localmente no navegador.
// Não há chave de IA, API paga ou envio dos arquivos para um servidor.
window.PFR_API_BASE = '';
window.PFR_PROCESSING_MODE = 'browser';
window.PFR_BROWSER_CONFIG = {
  business: {
    type: 'producao',
    includeEliminated: true,
    fillMissingTime: true,
    stemmingVariation: true,
    stemmingMaxDelta: 0.12,
    redistributeZeroCharges: true,
    chargeTarget: 17136.048,
    zeroChargeMinimum: 0.01,
    // Importação do BREX (BMO): o relógio do BMO grava em UTC; -3 converte para Brasília.
    brexOffsetHours: -3,
    brexOffsetMinHours: -12,
    brexOffsetMaxHours: 14,
    // Identificação do plano (espelho de business.plan_label_* e output_name_*).
    planLabelFallbackPrefix: 'PFR',
    planLabelMaxLength: 60,
    planLabelGenericNames: [
      'pp', 'pdf', 'plano', 'plano de perfuracao', 'plano de fogo', 'plano de fogo realizado',
      'plano realizado', 'copia', 'modelo', 'historial da bmo', 'projeto completo',
      'config final', 'configuracao final'
    ],
    outputNameTemplate: 'Plano_Fogo_Realizado_PP{plan_id}.xlsx',
    outputNameTextTemplate: 'Plano_Fogo_Realizado_{plan_label}.xlsx'
  }
};
