exports.handler = async (event) => {
  const { gameKey, offset } = event.queryStringParameters || {};

  const GAME_CONFIG = {
    lotto649:  { table: 'lotto649' },
    lottoMax:  { table: 'lottoMax' },
    lottario:  { table: 'Lottario' },
    ontario49: { table: 'ontario49' },
  };

  if (!gameKey || !GAME_CONFIG[gameKey]) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid game key" }) };
  }

  const BASE_ID = 'appb3kUnGTOIHFOyq';
  const table = GAME_CONFIG[gameKey].table;

  let url = `https://api.airtable.com/v0/${BASE_ID}/${table}?pageSize=100&sort[0][field]=Draw_Date&sort[0][direction]=desc`;
  if (offset) url += `&offset=${offset}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` }
  });

  const data = await res.json();

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  };
};