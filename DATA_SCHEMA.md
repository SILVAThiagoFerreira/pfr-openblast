# DATA_SCHEMA

## Projeto PP
Arquivo: `OPIT-PP*PROJETO COMPLETO*`

Campos principais:
- `Number` integer
- `UTM_X` float
- `UTM_Y` float
- `Length_m` float
- `Stemming_m` float
- `Diameter_mm` float
- `Subdrilling_m` float
- `Angle_deg` float
- `Azimuth_deg` float
- `Total_Charge_kg` float

## Realizado PP
Arquivo: `OPIT-PP*CONFIG FINAL*`

Campos principais:
- `Number` integer
- `X` float
- `Y` float
- `Z` float — cota (elevação, m) do collar. Se o valor estiver fora da faixa `business.elevation_plausible_min_m`..`max_m`, não é cota (pode ser coordenada X, como no export de 27/10/2026): a cota é obtida pela seção "Plano de Perfuração (cota)".
- `X_Toe` float
- `Y_Toe` float
- `Z_Toe` float — cota do fundo; segue `Z_Toe = Z - Length * cos(Angle)` no export verificado.
- `Length` float
- `Stemming` float
- `Diameter` float
- `Subdrilling` float
- `Angle` float
- `Azimuth` float
- `DetonatingTime` float na entrada; vazio, não numérico, negativo (inclusive `-1`) e repetição posterior são tratados como ausência. Na saída, é inteiro, não negativo e único por furo, preenchido por sequência determinística baseada na ordem de `Number` e nas âncoras vizinhas.
- `InputedCharge` float
- `eliminated` integer, optional

Regra de cardinalidade:
- `Config Final` é a fonte autoritativa dos IDs realizados. Com `business.include_eliminated: true` (padrão), registros presentes no `Config Final` são exportados mesmo quando o `Projeto Completo` informa `eliminated == 1`.
- Quando `business.include_eliminated: false`, os registros eliminados podem ser excluídos de forma explícita; o log registra a quantidade excluída.
- Com a inclusão habilitada, `Furos no Config Final` deve ser igual a `Furos exportados`.

## Plano de Perfuração (cota)
Arquivo: `Plano de Perfuração.xlsx` (`*PERFURA*.xlsx`, `PP*.xlsx` na CLI; no site, a planilha que tem as colunas abaixo, lida pela aba cujo nome contém `PROJETO PERFURA`). Não é fonte de furos nem de carga: fornece apenas a cota de referência.

Campos usados:
- `ID` integer — igual ao `Number` do Config Final (ex.: `ID` 171 = `Number` 171, mesmas coordenadas).
- `X Collar` float, `Y Collar` float — conferidos contra o `X`/`Y` do Config Final dentro de `business.elevation_design_match_tolerance_m`.
- `Z Collar` float — cota da boca (usada como `Z (crest)`).
- `Z Toe`, `Depth`, `Dip` — presentes na planilha, não usados pela cota (a profundidade realizada e a inclinação do Config Final definem o `Z (toe)`).

Regras de identificação: `ID` repetido impede a cota desse furo (aviso). Faltando qualquer das quatro colunas, a validação interrompe a execução.

Configuração (`config.yaml`, espelhada em `public/config.js`):
- `business.elevation_plausible_min_m` (-500) e `business.elevation_plausible_max_m` (5000): faixa de cota aceita.
- `business.elevation_design_match_tolerance_m` (0.5): tolerância X/Y em metros.
- `business.elevation_design_sheet_pattern` (`PROJETO PERFURA`): trecho do nome da aba, sem acentos nem caixa.
- `inputs.pp.design_patterns` (CLI) e `validation.required_design_columns`.

Exemplo validado (REG CRISTA F3, 27/10/2026): furo 171 — `Z Collar` 287,63; `Z (toe)` = 287,63 - 8,4 * cos(15°) = 279,516. Furos 1000, 1001, 1002, 1004 e 1006 do Config Final não existem no plano (Projeto Completo com UTM zerado): ficam sem cota.

## Simulação de teste
- `tampao previsto` e `tampao realizado` são exportados com uma casa decimal.
- `tampao realizado` pode receber variação determinística de até `0,12` para mais ou para menos quando habilitado na configuração.

## Redistribuição de carga zerada
- Quando existirem furos com `InputedCharge == 0`, a redistribuição deve usar `business.charge_total_target_kg` e `business.charge_zero_fill_min_kg`.
- Os furos com menor e maior carga não podem ser alterados.
- O total final da coluna deve permanecer idêntico ao total alvo configurado.

## Fechamento do total de carga
- Quando `business.enforce_charge_total_target: true`, o sistema deve ajustar `cargas realizadas` para fechar exatamente em `business.charge_total_target_kg` mesmo sem cargas zeradas.
- O ajuste só pode atuar nos furos intermediários.
- O menor e o maior valor de carga devem permanecer inalterados.
- Nenhum valor ajustado pode ficar abaixo do menor valor preservado nem acima do maior valor preservado.
- No site, o bloco opcional de carga realizada fornece o alvo da execução atual e tem precedência sobre a configuração. Quando habilitado, `chargeTarget` deve ser positivo, `chargeMinimum` deve ser positivo e `chargeMinimumHoleId` deve identificar exatamente um `Number` presente na saída. Esse furo recebe exatamente `chargeMinimum` e não pode pertencer ao grupo de máximos originais; a maior carga e todos os furos empatados nela são obtidos do `InputedCharge` original e preservados exatamente. Os demais furos intermediários são ajustados de forma determinística em todo o plano, sempre no intervalo `[chargeMinimum, maior carga original]`, e a soma final fecha no alvo. O Excel registra `Carga-alvo aplicado (kg)`, `Carga mínima aplicada (kg)`, `ID do furo de menor carga`, `Carga máxima preservada (kg)` e o `ID do furo de maior carga` original. Sem o bloco habilitado, a regra pública permanece desativada.
- Ao anexar um `Config Final` legível, a interface sugere `chargeMinimum` como a menor carga positiva de `InputedCharge` e `chargeMinimumHoleId` como o primeiro `Number` que possui esse valor. A sugestão é apenas um preenchimento inicial e não substitui edição manual.

## Historico de disparo
Arquivo: `HISTO-*.txt` ou `*_histo.log`; obrigatório no modo automático e opcional no modo forçado

Campos/eventos usados:
- `[BlastingPlan]YYYY/MM/DD-HH:MM:SS` abre o bloco operacional carregado no detonador.
- Linhas `PU...;PP<plano>;...` identificam o plano dentro do bloco, por exemplo `PP320526`.
- `[Fire]YYYY/MM/DD-HH:MM:SS` define a data e hora do disparo somente quando vem depois do `[BlastingPlan]` que contém o plano correto.
- `[StartProcedure]YYYY/MM/DD-HH:MM:SS` abre o bloco do novo padrão; linhas `BP: PP<plano>` identificam o plano e o primeiro `[Fire]` do bloco define a hora do desmonte.
- Cabeçalhos com espaço depois de `]` e registros `BMO:`/`DELAYS:` são aceitos. Quando necessário, o offset selecionado (`-03:00`, por exemplo) é aplicado à data/hora antes da saída.
- Numeros encontrados em listas de detonadores, testes ou falhas nao sao IDs de plano.
- O campo online `manualFireDate` aceita uma data ISO (`AAAA-MM-DD`). Se informado, ele define a data local do evento; sem HISTO, a execução forçada exige essa data e `manualFireTime`, registra `historySource: missing` e `dateSource: manual`, e não consulta a data do computador. A data e o horário informados são locais e não recebem conversão de fuso.
- Com HISTO, a data do primeiro `[Fire]` do bloco compatível continua sendo usada quando o campo de data fica vazio. Uma data digitada explicitamente prevalece sobre a data lida do HISTO e é mantida como data local.

## Entrada BREX (BMO)
Arquivo: `*.brex` exportado pelo sismógrafo BMO; lido somente no navegador, na importação do botão "Importar BREX (BMO)". Não é entrada do processamento pela linha de comando.

Formato: XML 1.0 em UTF-8 (uma cópia com BOM também é aceita). A raiz é `DB_BLASTREPORT_EXCHANGE`; `XSD_VERSION` vale `1.2` nas amostras.

Campos usados:
- `BLAST_CONTEXT/BLAST_EVENT_ID` abre um registro de evento; `BLAST_CONTEXT/TAG/FIRING_TAG` marca o evento de disparo. O evento usado como identificador é o último com `FIRING_TAG`, ou o último evento se nenhum tiver a marca.
- `DATA@DBD_SN` é o número de série do BMO (ex.: `312`).
- `DATA/DISPLAYED_NAME` é o nome do disparo no BMO. Pode ser um ID de plano (ex.: `PP590926`, `490926_B`), um nome sem ID (ex.: `REG_41__`) ou vazio.
- `DATA/SUMMARY_UNIT/CHRONO/FIRING_DATE` (`AAAA/MM/DD`), `FIRING_TIME_START` (`HH:MM:SS`) e `FIRING_TIME_END`. O disparo é o `FIRING_TIME_START` do bloco.
- `DATA/SUMMARY_UNIT/SUMMARY_DET/TOTAL` é o número de detonadores (opcional).
- `DATA/DETAIL_UNIT/DETONATOR` (`HOLE_ID`, `HOLE_RANK`, `PROGRAMMED_DELAY` etc.) não é usado pela importação.

Regras de leitura:
- Um disparo por bloco `DATA` com `FIRING_DATE` e `FIRING_TIME_START`. Bloco sem horário gera aviso e é ignorado; arquivo sem nenhum disparo, ou com data ou horário inválidos, é recusado.
- O horário do BMO é relógio do dispositivo. Nas amostras ele é UTC: o `BLAST_EVENT_ID` tem a forma `RBC_ID` (3 dígitos) + epoch em segundos UTC, e o epoch fica a poucos segundos do `TESTING_TIME` do CHRONO. Por isso o ajuste padrão é -3 h.
- Horário ajustado = horário do BMO + `business.brex_offset_hours` (inteiro de horas entre `brex_offset_min_hours` e `brex_offset_max_hours`). O ajuste pode mudar a data.
- Plano extraído do nome do BMO: `PP` + 6 a 8 dígitos, ou 6 dígitos isolados, validados como `PLANO;MÊS;ANO` (`plan-id.js`). O nome do arquivo não é fonte de plano.

Amostras observadas (7 arquivos de relatório, com um bloco `DATA` cada):
- `BMO312_20261027.brex` (27/10/2026): `DISPLAYED_NAME` = `REG_41__`; `FIRING_TIME_START` = `15:00:56` (12:00 em Brasília); `FIRING_TIME_END` = `15:01:06`, janela de 10 s compatível com `MAX_DELAY` de 10132 ms. O nome `CRISTA F3` não está no arquivo: aparece só no nome da pasta. Os identificadores disponíveis são o número de série 312, o evento `3221793113124` e o nome do arquivo.
- Outros arquivos de setembro/2026 têm `DISPLAYED_NAME` com plano (`PP560926`, `PP590926`, `490926_B`, `TB590926`) ou sem plano (`REG43092`), e `FIRING_TIME_START` entre 15:00 e 15:02 (UTC).

Disparo usado pela interface (`brex.js`): `{ bmoSerial, displayName, planIds, eventNumber, detonators, date (AAAA-MM-DD, do BMO), time (HH:MM:SS, do BMO), fileName }`.

Rótulo do disparo escolhido: plano do evento; sem plano, o ID digitado no campo de identificação; sem ele, o nome do BMO, o evento ou a série do BMO. O horário preenchido em `Horário local do desmonte` é HH:MM:SS, com os segundos do BMO.

## Saída Excel
Abas:
- `Dados dos Furos`
- `Resumo`

A aba `Resumo` contém somente três colunas e uma linha de dados: `Plano`, `Data` e `Hora`.

Colunas principais em `Dados dos Furos`:
- `Data`, `Horario`, `Plano`, `Tipo`, `id`, `y`, `x`, `Z (crest)`, `Z (toe)`, `profundidade prevista`, `profundidade realizada`, `azimute`, `inclinacao`, `cargas previstas`, `cargas realizadas`, `tampao previsto`, `tampao realizado`, `subfuracao`, `diametro`, `tempo detonacao (ms)`

## Metadados de identificação
IDs de plano podem aparecer como `PP370626`, `PP0370626` ou com separadores. A composição é `PLANO;MÊS;ANO`: os quatro últimos dígitos são mês e ano, e o trecho anterior é o plano. Para comparação, o prefixo e os separadores são removidos, zeros à esquerda do plano são ignorados, o ano deve ser igual e o mês é ignorado para permitir detonação em mês posterior ou anterior ao mês de emissão. A forma encontrada no HISTO é mantida como o ID do evento na saída. Se houver múltiplos blocos compatíveis, o mês coincidente tem prioridade; sem desempate único, a validação falha por ambiguidade.

O novo padrão também aceita marcadores `BP:440826` e `BP: PP440826`. No modo online, os metadados de identificação, execução e fontes do evento permanecem visíveis no resultado da página; a aba `Resumo` contém apenas `Plano`, `Data` e `Hora`. A execução forçada não desativa as validações de estrutura ou temporização.

### ID do plano no site (formato da coluna `Plano`)
A coluna `Plano` (em `Dados dos Furos` e em `Resumo`) passou a aceitar dois formatos:
- ID numérico normalizado (`PLANO` sem zeros à esquerda, 6 a 8 dígitos no texto de origem), por exemplo `440726`. Nome do arquivo: `Plano_Fogo_Realizado_PP440726.xlsx`.
- ID textual, exatamente como digitado (aparado nas extremidades), por exemplo `REG CRISTA F3`, ou derivado do nome do arquivo (`Crista F3`) ou gerado (`PFR_20261027_120056`). Nome do arquivo: `Plano_Fogo_Realizado_<nome sanitizado>.xlsx`, em que o nome sanitizado remove acentos, substitui espaços por `_`, remove caracteres inválidos em nomes de arquivo (`<>:"/\|?*` e controles) e é limitado a `business.plan_label_max_length` caracteres. Quando nada resta, o nome é `Plano_Fogo_Realizado.xlsx`.

A origem do ID é registrada no resultado (`Digitado`, `Anexos ou HISTO`, `Nome do arquivo (automático)`, `Gerado (automático)`). Um ID derivado ou gerado gera aviso. O ID gerado usa `business.plan_label_fallback_prefix`, a data e o horário do disparo já resolvidos, sem usar o relógio do computador.

Quando o texto digitado contém um ID numérico entre outras palavras, o número é usado para localizar o bloco no HISTO e o texto continua sendo a coluna `Plano`. O campo `histoPlanId` do resultado guarda o ID do HISTO quando ele é diferente do ID gravado.

### Cabeçalhos de tabela (site)
As colunas obrigatórias de `Projeto Completo` e `Config Final` são reconhecidas sem diferenciar caixa, acentos, espaços e separadores, somente quando a variação casa com exatamente uma coluna conhecida e a coluna exata ainda não existe. Cada ajuste gera aviso no resultado, apenas para as tabelas que alimentam o cálculo. Aliases já existentes (ex.: `Angle (º)` → `Angle_deg`) continuam sem aviso.
