# Histórico de Execução

## 2026-04-13

- Criada a pasta `core/templates`.
- Copiados os templates base de produção e pré-corte para `core/templates`.
- Ajustados os módulos para priorizar os templates centrais.
- Removidos os templates redundantes das pastas de input.

- Implementado o gerador de pré-corte em `modulos/precorte/gerar_plano_realizado.py`.
- Corrigido o `ID.csv` do pré-corte para usar comprimentos e cargas realizados.
- Recalculados `X_Toe`, `Y_Toe` e `Z_Toe` com base na geometria prevista e no comprimento realizado.
- Corrigido o filtro do pré-corte para considerar apenas os 53 furos realmente detonados.
- Ajustada a regra do pré-corte para redistribuir as cargas e fechar exatamente com o total lido em `Consumo.png`.
- Registrada como regra permanente: no pré-corte, o software deve sempre redistribuir as cargas dos furos reais para fechar exatamente com o total da imagem de consumo, aplicando eventual residuo de arredondamento no ultimo furo.

- Corrigido o consumo de encartuchado do pré-corte.
- Valor correto detectado na imagem: `750 kg`.

- Implementada a regra de `Banco / Área` pela cota dominante.
- Resultado atual do caso analisado: `190-180`.

- Material detectado no plano/liberação disponível: `Minério/ Estéril`.

- Pendências que exigem refinamento adicional:
  - regra de `M10`;
  - regra de `AA39/AA40/E18`;
  - limpeza dos placeholders do template de pré-corte.

## 2026-04-23

- Validado `TEMP.pdf` contra o Excel gerado da producao.
- Regra consolidada: o `MIC:` do `TEMP.pdf` define o teto da carga realizada.
- Referencias operacionais registradas: `388 = 139.9 kg` e `537 = 173.3 kg`.
- Ajuste da producao refinado para reduzir repeticao excessiva de cargas, mantendo total exato e pontos fixos.
