# Estação Meteorológica · Russas, CE

Página que mostra, em tempo real, os dados de uma estação meteorológica feita com ESP32, instalada no campus da UFC em Russas.

O ESP32 envia uma leitura por minuto ao [ThingSpeak](https://thingspeak.com), e a página lê esses dados pela API do canal e se atualiza sozinha a cada minuto.

## O que a página mostra

- Temperatura atual, mínima e máxima do dia, e sensação térmica com alerta de calor
- Umidade e ponto de orvalho
- Pressão ao nível do mar, com a tendência de 3 h
- Chuva do dia e intensidade da chuva
- Vento médio, rajada e direção, numa rosa dos ventos
- Índice local de chuva (estimativa feita com os sensores; **não** é previsão oficial)
- Gráficos das últimas 24 h (médias de 30 min)
- Horário da última atualização, com indicador verde (no ar) ou laranja (sem sinal há mais de 5 min)

## Estação

| Sensor | Mede |
|---|---|
| DHT22 | Temperatura e umidade |
| MS5611 (GY-63) | Pressão |
| Pluviômetro de báscula | Chuva (0,25 mm por báscula) |
| Anemômetro de conchas | Velocidade do vento |
| Biruta resistiva | Direção do vento (8 setores) |

As médias seguem o guia da OMM (WMO-No. 8): temperatura, umidade e pressão em 1 min; vento em 10 min; rajada como a maior janela de 3 s.

## Campos do canal ThingSpeak

| Campo | Variável |
|---|---|
| 1 | Temperatura (°C), média de 1 min |
| 2 | Umidade (%), média de 1 min |
| 3 | Pressão na estação (hPa), média de 1 min |
| 4 | Chuva do dia (mm), zera às 00:00 |
| 5 | Vento médio (km/h), 10 min |
| 6 | Rajada (km/h), 10 min |
| 7 | Direção (graus, de onde o vento vem; vazio = calmo) |
| 8 | Índice de chuva (0 a 100) |

A página calcula a partir desses campos:

- **Ponto de orvalho:** fórmula de Magnus
- **Sensação térmica:** índice de calor da NOAA, com as faixas de alerta do NWS (Cuidado, Cuidado extremo, Perigo, Perigo extremo)
- **Pressão ao nível do mar:** redução pela altitude do sensor

## Arquivos

```
index.html        estrutura da página
style.css         visual
script.js         busca os dados, faz os cálculos e desenha os gráficos
assets/
  estacao.jpg     foto do rodapé
  ufc_logo.png    logo da UFC
  nicite.png      logo do NICITE
  favicon.png     ícone da aba
  location.svg    ícone de local
```

## Como usar

1. No começo do `script.js`, ajuste a `URL_TS` com o ID do seu canal.
2. Preencha `ALTITUDE_M` com a altitude do sensor, para a pressão ao nível do mar.
3. Publique em qualquer hospedagem estática (Netlify, GitHub Pages, Vercel…).

## Segurança

**Nunca** coloque neste repositório a **Write API Key** do ThingSpeak nem a senha do Wi-Fi: elas ficam só no firmware do ESP32.

A Read API Key que está no `script.js` só permite ler os dados. Para não expor nenhuma chave, deixe o canal público e tire o `&api_key=...` da URL.

## Créditos e licenças

- Desenvolvido por **Mylena Nascimento**
- Ícones do tempo: [Weather Iconic](https://konradmichalik.github.io/weather-iconic/), de Konrad Michalik, sob licença [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
- Gráficos: [Chart.js](https://www.chartjs.org) (licença MIT)
- Fontes: [Nunito](https://fonts.google.com/specimen/Nunito) e [Zeyada](https://fonts.google.com/specimen/Zeyada) (SIL Open Font License)