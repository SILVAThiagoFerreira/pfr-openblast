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
    // Passo entre os furos zerados na redistribuição padrão (sem bloco de carga-alvo): a escada começa em
    // zeroChargeMinimum e sobe neste passo (reduzido, com aviso, se não couber abaixo da menor carga positiva).
    // Espelho de business.charge_zero_fill_step_kg (tests/test_browser_config.py verifica a igualdade).
    zeroChargeStepKg: 0.001,
    // Carga mínima por furo (bloco de carga-alvo): teto do passo entre as cargas de carga baixa; o passo real é
    // escolhido pelo sistema dentro desse teto (espelho de business.charge_minimum_step_kg; test_browser_config).
    chargeMinimumStepKg: 5,
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
    outputNameTextTemplate: 'Plano_Fogo_Realizado_{plan_label}.xlsx',
    // Cota (Z) do realizado (espelho de business.elevation_*; tests/test_browser_config.py verifica a igualdade).
    elevationPlausibleMinM: -500,
    elevationPlausibleMaxM: 5000,
    elevationDesignMatchToleranceM: 0.5,
    elevationDesignSheetPattern: 'PROJETO PERFURA',
    // Furo de assinatura (espelho de business.signature_hole_id; vazio = sem furo de assinatura). Carga e tampão
    // desse furo não recebem ajustes automáticos; conversões, arredondamentos, tempo e cota seguem a regra normal.
    signatureHoleId: ''
  }
};
