# Documentacao Do Fluxo Do Plano Realizado

## Objetivo Deste Arquivo

Este documento descreve, em detalhes, o que o codigo atual faz para gerar o plano de fogo realizado. Ele existe para servir como referencia operacional do projeto e como base para futuras manutencoes, correcoes e modularizacao.

O objetivo e que qualquer pessoa ou modelo consiga entender o funcionamento do fluxo atual sem depender de releitura completa do script principal. Este arquivo deve ser mantido atualizado sempre que o comportamento do codigo mudar.

Arquivo principal atual do fluxo:

- `modulos/producao/gerar_plano_realizado.py`

## Escopo Atual

Hoje o projeto esta orientado para gerar um plano de fogo realizado de producao. O fluxo atual:

- le os arquivos de entrada na pasta `imput`
- consolida dados de perfuracao, realizado, temporizacao, consumo e metadados do plano
- monta uma tabela `Enaex_DATA`
- preenche um template Excel `.xls`
- exporta o resultado em `.xls`, `.pdf` e `.csv`
- gera tambem um CSV adicional no formato de identificacao final do plano

Este fluxo agora esta posicionado dentro do modulo de producao, e a estrutura do projeto foi preparada para receber tambem o modulo de pre-corte.

## Estrutura Geral De Pastas

- `modulos/producao/`: codigo do modulo de planos de fogo realizados de producao
- `modulos/precorte/`: codigo do modulo de planos de fogo realizados de pre-corte
- `modulos/comum/`: componentes compartilhados entre os modulos
- `data/inputs/producao_realizado/`: entradas operacionais do fluxo atual de producao
- `data/inputs/precorte_realizado/`: entradas operacionais do novo fluxo de pre-corte
- `data/outputs/producao_realizado/`: saidas do fluxo de producao
- `data/outputs/precorte_realizado/`: saidas do fluxo de pre-corte
- `docs/`: documentacao operacional do projeto

## Arquivos De Entrada Utilizados Hoje

### 1. `data/inputs/producao_realizado/previsto.csv`

Representa a relacao inicial de furos do plano previsto.

Campos usados no fluxo atual:

- `Number`
- `X`
- `Y`
- `Z`
- `Length`
- `Stemming`
- `Diameter`
- `Subdrilling`
- `DesignCharge`
- `Burden`
- `Spacing`

Uso principal:

- fornecer dados planejados por furo
- servir como base de `Burden` e `Spacing`
- servir como fallback para alguns dados estruturais

### 2. `data/inputs/producao_realizado/realizado.csv`

Representa a relacao final do campo, incluindo furos excluidos.

Campos relevantes usados hoje:

- `Nu`
- `PX`
- `PY`
- `r_length`
- `r_stemming`
- `r_explosive`
- `explosive`
- `subdrilling`
- `eliminated`

Regra principal:

- somente linhas com `eliminated == 0` entram no conjunto final de furos ativos

Uso principal:

- definir os furos finais do plano realizado
- fornecer metros realizados
- fornecer tampao realizado
- fornecer carga realizada

### 3. `data/inputs/producao_realizado/pp.xlsx`

Planilha do plano de perfuracao. O codigo procura a aba cujo nome contem `PROJETO PERFURA`.

Campos usados hoje nessa aba:

- `ID`
- `X Collar`
- `Y Collar`
- `Z Collar`
- `Azimuth`
- `Dip`

Uso principal:

- fornecer coordenadas do plano para o CSV final tipo ID
- fornecer `Angle` e `Azimuth` do CSV final
- fornecer `X`, `Y`, `Z` do furo de referencia da capa

### 4. `data/inputs/producao_realizado/PP0250326.pdf`

Plano de perfuracao em PDF usado para extrair metadados da capa.

Campos inferidos a partir do texto do PDF:

- codigo fonte do plano
- data fonte do plano
- banco / area
- malha
- burden nominal
- spacing nominal
- densidade da rocha
- massa
- area
- metros nominais do plano
- numero de furos informado no PDF
- subperfuracao nominal
- materiais / litologia

Uso principal:

- preencher campos da capa
- servir como fallback de informacoes geotecnicas e de malha

### 5. `data/inputs/producao_realizado/Consumo.png`

Imagem usada com OCR para extrair consumo principal e tabela de regularizacao.

Uso principal:

- extrair consumo total de emulsao
- extrair quantidades de iniciadores e booster
- extrair itens da tabela de regularizacao / blocos

### 6. `data/inputs/producao_realizado/HISTO-*.txt`

Log da blast box.

Uso principal:

- localizar horario real do desmonte

Regra atual:

- usar o primeiro evento `[Fire]`
- se nao houver log ou nao houver evento valido, usar `12:00:00`

### 7. Template Excel `.xls`

Arquivo de template do plano preenchido pelo script.

Abas usadas:

- `Enaex_DATA`
- `Capa`
- `Cargas`

Uso principal:

- receber a tabela final de dados
- receber os campos da capa
- gerar o `.xls` final
- exportar o `.pdf` final

## Arquivos De Saida Gerados Hoje

Na pasta `data/outputs/producao_realizado/Plano de Fogo Realizado - <sufixo>` o codigo gera:

- `Enaex_DATA_preenchido.csv`
- `PP<codigo>_ID.csv`
- `Plano de Fogo Realizado - <sufixo>_preenchido.xls`
- `Plano de Fogo Realizado - <sufixo>_preenchido.pdf`
- `plano_execucao_realizado.txt`

## Sequencia Operacional Do Codigo

### 1. Define caminhos e constantes

No inicio do script sao definidos:

- pasta raiz
- pasta `data/inputs/producao_realizado`
- pasta `data/outputs`
- codigo do plano e nome da pasta de saida
- arquivos de entrada e saida
- constantes de densidade e exportacao Excel

### 2. Carrega o plano de perfuracao `pp.xlsx`

Funcao:

- `load_pp_project()`

O que faz:

- abre `pp.xlsx`
- encontra a aba que contem `PROJETO PERFURA`
- seleciona as colunas necessarias
- renomeia `ID` para `Number`
- converte valores numericos

Uso posterior:

- CSV final tipo ID
- furo de referencia da capa

### 3. Carrega os tempos planejados de `previsto.csv`

Funcao:

- `load_planned_timing_data()`

O que faz:

- le `previsto.csv`
- normaliza nomes de colunas
- converte `Number` e `DetonatingTime` para numerico

### 4. Preenche tempos faltantes na temporizacao

Funcao:

- `fill_missing_timing_values(base, timing)`

O que faz hoje:

- faz merge do conjunto base com `previsto.csv`
- identifica furos sem `DetonatingTime`
- busca vizinhos proximos por distancia espacial usando `X Collar` e `Y Collar`
- pega os 8 vizinhos mais proximos
- reduz para uma faixa local de vizinhos proximos
- calcula a mediana dos tempos dessa faixa
- arredonda o valor para dezenas

Observacao importante:

- esta e uma heuristica espacial
- nao e uma logica perfeita de temporizacao
- existe para preencher furos sem tempo quando a base tem lacunas

### 5. Le e interpreta o log da blast box

Funcao:

- `extract_blast_time()`

Regra atual:

- procura arquivos `HISTO-*.txt`
- busca o primeiro evento `[Fire]YYYY/MM/DD-HH:MM:SS`
- usa a hora extraida como horario oficial do desmonte
- fallback: `12:00:00`

### 6. Extrai texto do PDF de perfuracao

Funcoes:

- `extract_pdf_text()`
- `parse_perfuration_metadata()`

O que faz:

- le o texto do PDF com `pypdf`
- busca expressoes regulares para extrair metadados

Metadados extraidos:

- codigo do plano
- data do PDF
- banco / area
- malha
- burden e spacing nominais
- densidade da rocha
- massa
- area
- metros do plano
- numero de furos do PDF
- subperfuracao
- identificacao textual de diametro

Observacao importante:

- alguns metadados de capa continuam vindo do PDF, nao do realizado

### 7. Extrai consumo e regularizacao por OCR

Funcoes:

- `extract_primary_consumption()`
- `extract_regularization_consumption()`

Bibliotecas usadas:

- `PIL`
- `easyocr`
- `numpy`

O que faz:

- recorta regioes especificas da imagem
- converte para tons de cinza
- aumenta contraste
- binariza a imagem
- usa OCR para extrair texto
- reorganiza os blocos lidos por linha aproximada

Saidas desse processo:

- quantidade de DVT
- quantidade de Brinel
- quantidade de booster 450
- massa total de emulsao
- tabela de itens de regularizacao

Observacao importante:

- esse processo depende fortemente do layout da imagem
- pequenas mudancas visuais podem quebrar a leitura

### 8. Monta o `Enaex_DATA`

Funcao:

- `build_enaex_data(target_consumo_kg)`

O que faz:

- le `previsto.csv`
- le `realizado.csv`
- renomeia `Nu` para `Number`
- converte campos numericos principais
- filtra furos ativos com `eliminated == 0`
- monta um dataframe de realizado com:
  - `Number`
  - `PX`, `PY`
  - `r_length`
  - `r_stemming`
  - `subdrilling`
  - `r_explosive`
- converte esse bloco para nomes padrao internos:
  - `UTM X Real`
  - `UTM Y Real`
  - `Length_Real (m)`
  - `Stemming_Real (m)`
  - `Subdrilling_Real (m)`
  - `Charge_Bulk_Real (Kg)`

Depois disso:

- faz merge com o previsto por `Number`
- determina os campos planejados usando o previsto e fallback para realizado quando necessario

Campos produzidos no `Enaex_DATA`:

- `Number`
- `Length (m)`
- `Length_Real (m)`
- `Stemming (m)`
- `Stemming_Real (m)`
- `Diameter (mm)`
- `Diameter_Real (mm)`
- `Subdrilling (m)`
- `Subdrilling_Real (m)`
- `Charge_Bulk (Kg)`
- `Charge_Bulk_Real (Kg)`

### 9. Fecha o total de consumo com ajuste artificial

Ainda dentro de `build_enaex_data()` o codigo faz um ajuste forçado para bater o total de emulsao.

Logica atual:

- calcula a soma atual de `Charge_Bulk_Real (Kg)`
- compara com o alvo `TARGET_CONSUMO_KG`
- tenta distribuir a diferenca entre os furos `848` e `1002`
- se eles nao existirem, usa os 2 furos com maior carga
- aplica metade da diferenca em cada um
- faz arredondamento para 3 casas
- corrige o residuo final no segundo furo

Observacao critica:

- isso altera artificialmente a carga final de campo
- varios indicadores da capa passam a depender desse ajuste

## Regras Consolidadas Da Produção Atual

- O `TEMP.pdf` deve ser comparado com o Excel gerado antes de salvar.
- O `MIC:` do `TEMP.pdf` define a carga maxima realizada.
- Os furos destacados nas paginas de histograma do `TEMP.pdf` devem ter as cargas corretas no Excel.
- As referencias operacionais atuais sao `388 = 139.9 kg` e `537 = 173.3 kg`.
- A redistribuicao precisa manter o total exato e evitar blocos repetitivos de carga.
- As cargas ajustadas devem ter variabilidade pequena e deterministica antes do arredondamento.
- Furos com carga e profundidade validas nao devem sair zerados no output final.

### 10. Monta o CSV final tipo ID

Funcao:

- `build_id_csv(previsto, realizado)`

Fluxo:

- le `previsto.csv`
- le `realizado.csv`
- filtra furos ativos
- converte campos numericos relevantes
- le `pp.xlsx`
- junta essas bases por `Number`
- preenche tempos faltantes com heuristica espacial

Mapeamento atual do CSV tipo ID:

- `Number`: `realizado.csv -> Nu`
- `X`: `pp.xlsx -> X Collar`
- `Y`: `pp.xlsx -> Y Collar`
- `Z`: `pp.xlsx -> Z Collar`
- `Length`: `realizado.csv -> r_length`
- `Stemming`: `realizado.csv -> r_stemming`
- `Burden`: `previsto.csv -> Burden`
- `Spacing`: `previsto.csv -> Spacing`
- `Angle`: `pp.xlsx -> Dip`
- `Azimuth`: `pp.xlsx -> Azimuth`
- `DetonatingTime`: `previsto.csv -> DetonatingTime`, com inferencia para faltantes
- `InputedCharge`: `realizado.csv -> r_explosive`, fallback `explosive`

Observacao importante:

- se um furo existir no realizado mas nao existir em `pp.xlsx` ou no `previsto.csv`, esse furo pode sair com coordenadas, angulo, azimute, `Z` ou temporizacao faltantes

### 11. Calcula estatisticas da capa

Funcao:

- `build_cover_stats()`

Entradas principais:

- `enaex`
- `ativos`
- um furo de referencia selecionado aleatoriamente do `id_csv`
- metadados do PDF
- consumo principal extraido da imagem

Regra atual para o furo de referencia:

- selecionar aleatoriamente um furo qualquer do `id_csv`

Campos calculados:

- numero do furo de referencia
- `X`, `Y`, `Z` do furo de referencia
- numero total de furos
- altura media de bancada aproximada
- perfuracao media realizada
- metros realizados totais
- explosivo total
- massa total
- volume total
- razao de carga linear
- fatores de carga
- tampao medio
- carga media por furo
- perfuracao especifica
- CME
- coluna media carregada
- tampao planejado total
- volume por furo
- quantidades de iniciadores e boosters

## Origem Dos Principais Campos Da Capa

### Coordenadas (N°/Furo)

Hoje o bloco da capa usa:

- numero do furo: `id_csv -> Number`
- `Y`: `id_csv -> Y`
- `X`: `id_csv -> X`
- `Z`: `id_csv -> Z`

Formato exibido:

- `id, y, x, z`

### Data da capa

Campo da capa com data e hora:

- data: derivada de `PLAN_SUFFIX`
- hora: log da blast box ou fallback `12:00:00`

### Data do cabecalho de cargas

Campo `Data:` na aba de cargas:

- apenas `blast_date`
- sem hora

### Banco / area

- origem: PDF de perfuracao

### Malha

- origem: PDF de perfuracao

### Burden e Spacing da capa

- origem: PDF de perfuracao

### Numero de furos

- origem: quantidade de furos ativos do realizado

### Metros realizados

- origem: soma de `Length_Real (m)`
- coluna-base: `realizado.csv -> r_length`

### Razao de carga linear

Formula atual:

- `explosivo total / metros realizados`

Origem do explosivo total:

- `Consumo.png` via OCR

Origem dos metros realizados:

- soma de `r_length` do realizado

### CME

Prioridade atual:

- `Total_Charge_Real (Kg)` se existir
- senao `r_explosive`
- senao `Charge_Bulk_Real (Kg)`

### Diametro dominante

Prioridade atual:

- moda de `Diameter_Real (mm)` se existir
- fallback: `127 mm`

### Materiais

- origem: PDF de perfuracao
- inferido a partir de texto como `Minerio / Esteril`

## Preenchimento Do Excel

Funcao:

- `write_to_xls()`

Fluxo:

- abre o template `.xls`
- limpa a area de dados da aba `Enaex_DATA`
- escreve a tabela gerada
- preenche a aba `Capa`
- preenche o cabecalho da aba `Cargas`
- preenche a tabela de regularizacao na capa
- ajusta a area de impressao da aba `Cargas`
- salva o `.xls`
- esconde temporariamente abas nao usadas
- exporta o `.pdf`
- restaura a visibilidade das abas

## Arquivo De Texto De Execucao

Funcao:

- `save_plan_text()`

O que faz:

- gera um resumo textual do fluxo executado
- registra objetivos, regras aplicadas e caminhos de saida

## Dependencias Tecnicas

Bibliotecas principais usadas:

- `pandas`
- `numpy`
- `easyocr`
- `PIL`
- `pypdf`
- `win32com.client`

Dependencias de ambiente:

- Microsoft Excel instalado no Windows
- automacao COM funcionando
- arquivos de entrada com nomes esperados

## Limitações E Pontos Frageis Atuais

### 1. Nomes de arquivo fixos

O script depende de nomes fixos como:

- `previsto.csv`
- `realizado.csv`
- `pp.xlsx`
- `PP0250326.pdf`
- `Consumo.png`

### 2. Dependencia do layout do OCR

Mudancas visuais em `Consumo.png` podem quebrar a extração de:

- emulsao total
- iniciadores
- boosters
- itens de regularizacao

### 3. Heuristica de tempos faltantes

A inferencia de `DetonatingTime` por vizinhanca e apenas uma aproximacao. Ela e usada quando o `previsto.csv` tiver lacunas nos tempos e pode nao refletir exatamente a logica operacional da temporizacao real.

### 4. Furos sem correspondencia entre bases

Se um furo existir no realizado mas nao existir em `pp.xlsx` ou no `previsto.csv`, ele pode sair sem:

- coordenadas completas
- `Z`
- `Angle`
- `Azimuth`
- `DetonatingTime`

### 5. Ajuste artificial de carga

O fechamento forcado do consumo altera cargas reais e impacta:

- CME
- carga media
- razao de carga linear
- distribuicao final de carga

### 6. Mistura de fontes distintas

O sistema combina dados de:

- realizado
- previsto
- PDF
- OCR
- temporizacao

Isso significa que alguns indicadores nao sao 100 por cento oriundos de uma unica fonte operacional.

## Regras De Negocio Atuais Em Resumo

- conjunto final de furos = `realizado.csv` com `eliminated == 0`
- `Nu` do realizado vira `Number`
- metros realizados = soma de `r_length`
- carga final base = `r_explosive`
- `InputedCharge` do CSV ID = `r_explosive`, fallback `explosive`
- `Burden` e `Spacing` do CSV ID = `previsto.csv`
- `X`, `Y`, `Z`, `Angle`, `Azimuth` do CSV ID = `pp.xlsx`
- `DetonatingTime` do CSV ID = `previsto.csv`, com inferencia para faltantes
- horario do desmonte = primeiro `[Fire]` do log `HISTO-*.txt`, fallback `12:00:00`
- furo da capa = escolha aleatoria entre furos do plano final
- `Data:` do cabecalho = sem hora

## Diretriz Para Manter Esta Documentacao Atualizada

Sempre que o codigo mudar, atualizar este arquivo em pelo menos estes pontos:

- entradas utilizadas
- saidas geradas
- mapeamento de campos
- calculos de capa
- regras de fallback
- heuristicas novas
- riscos ou limitacoes novos

Nao deixar o documento generico. Ele deve refletir o comportamento real do codigo em producao.

## Diretrizes Para Modularizacao Futura

O projeto deve ser separado em pelo menos dois modulos:

- modulo de planos de producao
- modulo de planos de pre-corte

### Partes que tendem a ser comuns

- leitura de caminhos e configuracao
- extracao de horario do log da blast box
- leitura de PDF
- OCR da imagem de consumo
- escrita em Excel e exportacao PDF
- utilitarios de formatacao e parse numerico

### Partes que tendem a ser especificas de producao

- layout atual do template Excel
- regras de capa de producao
- mapeamento atual do CSV ID
- calculos especificos de producao
- heuristicas de ajuste de consumo atuais

### Partes que provavelmente vao divergir no pre-corte

- modelo de planilha
- campos da capa
- regras de calculo
- fontes de entrada necessarias
- estrategia de preenchimento e exportacao

### Separacao sugerida no futuro

- `modulos/comum/`
- `modulos/producao/`
- `modulos/precorte/`

Com possiveis componentes:

- `config.py`
- `io_inputs.py`
- `pdf_metadata.py`
- `ocr_consumo.py`
- `excel_writer.py`
- `producao/gerador.py`
- `precorte/gerador.py`

## Debitos Tecnicos Que Precisam Ser Observados

- revisar furos sem correspondencia entre bases
- revisar logica de temporizacao faltante
- revisar ajuste artificial de consumo
- revisar origem de alguns campos de capa para manter consistencia operacional
- reduzir dependencia de nomes fixos de arquivos
- tornar o sufixo do plano configuravel sem editar codigo

## Conclusao

Hoje o fluxo funciona como um gerador consolidado de plano realizado de producao, alimentado por varias fontes. Ele ja produz os arquivos principais, mas ainda possui pontos de fragilidade tipicos de um fluxo operacional em consolidacao.

Esta documentacao deve ser tratada como contrato vivo do comportamento atual. Sempre que o codigo mudar, este arquivo precisa ser atualizado junto.
