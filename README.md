# Estação Meteorológica

Página que mostra, em tempo real, os dados de uma estação meteorológica feita com ESP32.

Os dados chegam do ESP32 ao [ThingSpeak](https://thingspeak.com) a cada minuto, e a página os lê pela API pública do canal.

## O que mostra

- Temperatura, umidade e pressão (com tendência de 3 h)
- Chuva acumulada do dia
- Vento (média, rajada e direção)
- Índice de chuva (estimativa a partir dos sensores; não é previsão oficial)
- Gráficos das últimas 24 horas

## Campos do canal ThingSpeak

| Campo | Variável |
|---|---|
| 1 | Temperatura (°C) |
| 2 | Umidade (%) |
| 3 | Pressão (hPa) |
| 4 | Chuva do dia (mm) |
| 5 | Vento médio (km/h) |
| 6 | Rajada (km/h) |
| 7 | Direção (graus, de onde o vento vem) |
| 8 | Índice de chuva (0 a 100) |

## Como usar

1. Abra `index.html` e preencha o `CHANNEL_ID` do seu canal (público) no começo do script.
2. Publique em qualquer hospedagem estática (por exemplo, Vercel).

## Segurança

**Nunca** coloque neste repositório a Write API Key do ThingSpeak, nem a senha do WiFi. Só o `CHANNEL_ID` (público) pode ficar aqui.
