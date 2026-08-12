# Inputs Do Plano De Fogo Realizado De Producao

Lista consolidada dos arquivos de entrada do modulo de plano de fogo realizado de producao e a origem operacional de cada um.

## Arquivos E Origens

- `previsto.csv` -> arquivo exportado da temporizacao inicial prevista do OpitBlast
- `realizado.csv` -> arquivo puxado do Opit Analytics
- `pp.xlsx` -> plano de perfuracao de producao
- `PP0250326.pdf` -> plano de perfuracao em PDF
- `Consumo.png` -> dados de consumo do desmonte em imagem
- `Config Final.csv` -> arquivo de temporização exportado após Atualização dos Furos, com as quantidades iguais ao executado
- `Projeto Completo.csv` -> arquivo de QAQC do O-PitSurface
- `Plano de Perfuração.xlsx` -> planilha do plano de perfuração
- `Plano de Perfuração.pdf` -> PDF do plano de perfuração
- `HISTO-*.txt` ou `*_histo.log` -> histórico da DRB (blast box)
- `template Excel .xls` -> template do plano de fogo realizado de producao

## Regra Atual Dos Tempos

- os tempos dos furos passam a ser lidos de `previsto.csv`, pela coluna `DetonatingTime`
- `timing.csv` nao e mais um arquivo obrigatorio do modulo de producao

## Regra Atual Do Historico

- O formato antigo `.txt` continua aceito.
- O novo formato `*_histo.log` usa `[StartProcedure]`, linhas `BP:` e `[Fire]`; o primeiro `[Fire]` do bloco correspondente ao plano é usado.
- O site permite converter o horário do HISTO para `UTC-03:00` antes de gerar o Excel.

## Pasta Esperada

Os arquivos operacionais do modulo de producao devem ficar em:

- `data/inputs/producao_realizado/`

As saidas geradas pelo modulo de producao devem ficar em:

- `data/outputs/producao_realizado/`

## Observacao

Se no futuro houver mudanca na origem de algum arquivo, este documento deve ser atualizado para manter o rastreio correto entre o input tecnico e a fonte operacional.
