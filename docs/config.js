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
    brexOffsetMaxHours: 14
  }
};
