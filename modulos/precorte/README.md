# Modulo de Pre-Corte

Este diretorio foi criado para receber o segundo modulo do projeto: geracao de planos de fogo realizados de pre-corte.

Estrutura inicial sugerida:

- `gerar_plano_precorte.py`: ponto de entrada do modulo.
- `config.py`: nomes de arquivos, caminhos e parametros especificos do pre-corte.
- `mapper.py`: regras de mapeamento dos campos de entrada para o layout final.
- `cover.py`: calculos e preenchimento da capa do pre-corte.
- `excel_writer.py`: escrita no template do pre-corte.

Inputs previstos:

- arquivos equivalentes aos de producao, quando aplicavel;
- um input adicional exclusivo do pre-corte, a ser definido na modelagem do modulo.

Pastas do modulo:

- `data/inputs/precorte_realizado/`
- `data/outputs/precorte_realizado/`

Diretriz:

- tudo que for comum entre `producao` e `precorte` deve nascer em `modulos/comum`.
