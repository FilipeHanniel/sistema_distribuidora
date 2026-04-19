const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const dbPath = path.join(__dirname, 'banco.sqlite');
const db = new Database(dbPath);

const products = [
  // Cervejas
  { name: 'Cerveja Skol Lata 350ml', barcode: '7891991000886', cost: 2.50, sell: 4.50, stock: 120, cat: 'Cervejas' },
  { name: 'Cerveja Brahma Duplo Malte 350ml', barcode: '7891991015385', cost: 2.80, sell: 5.00, stock: 96, cat: 'Cervejas' },
  { name: 'Cerveja Heineken Long Neck 330ml', barcode: '7891991010397', cost: 4.50, sell: 8.50, stock: 72, cat: 'Cervejas' },
  { name: 'Cerveja Antarctica Boa 600ml', barcode: '7891111111111', cost: 5.50, sell: 9.00, stock: 48, cat: 'Cervejas' },
  { name: 'Cerveja Corona Extra 330ml', barcode: '7891991014715', cost: 5.00, sell: 9.50, stock: 60, cat: 'Cervejas' },
  
  // Refrigerantes
  { name: 'Coca-Cola 2 Litros', barcode: '7894900011517', cost: 7.50, sell: 12.00, stock: 40, cat: 'Refrigerantes' },
  { name: 'Guaraná Antarctica 2 Litros', barcode: '7891991001357', cost: 6.00, sell: 10.00, stock: 36, cat: 'Refrigerantes' },
  { name: 'Coca-Cola Lata 350ml', barcode: '7894900010015', cost: 2.50, sell: 5.00, stock: 100, cat: 'Refrigerantes' },
  { name: 'Pepsi 2 Litros', barcode: '7892840800045', cost: 5.80, sell: 9.50, stock: 30, cat: 'Refrigerantes' },
  
  // Destilados
  { name: 'Vodka Smirnoff 998ml', barcode: '78935495', cost: 28.00, sell: 45.00, stock: 12, cat: 'Destilados' },
  { name: 'Whisky Red Label 1L', barcode: '5000267023228', cost: 75.00, sell: 120.00, stock: 6, cat: 'Destilados' },
  { name: 'Gin Tanqueray 750ml', barcode: '5000291020460', cost: 85.00, sell: 140.00, stock: 4, cat: 'Destilados' },
  
  // Água e Outros
  { name: 'Água Mineral Crystal s/ Gás 500ml', barcode: '7894900530001', cost: 0.80, sell: 2.50, stock: 200, cat: 'Água' },
  { name: 'Água Mineral Crystal c/ Gás 500ml', barcode: '7894900531008', cost: 1.00, sell: 3.00, stock: 150, cat: 'Água' },
  { name: 'Gelo de Coco (Unidade)', barcode: '1112223334445', cost: 1.50, sell: 4.00, stock: 80, cat: 'Gelo' },
  { name: 'Gelo em Cubos 5kg', barcode: '2223334445556', cost: 5.00, sell: 12.00, stock: 20, cat: 'Gelo' },
  
  // Petiscos
  { name: 'Batata Pringles 114g Original', barcode: '5053990138722', cost: 8.50, sell: 15.00, stock: 24, cat: 'Petiscos' },
  { name: 'Carvão Vegetal 4kg', barcode: '3334445556667', cost: 12.00, sell: 22.00, stock: 15, cat: 'Utilidades' }
];

function seed() {
  const insert = db.prepare(`
    INSERT INTO products (id, barcode, name, costPrice, sellPrice, stock, category, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();
  let count = 0;

  console.log('Iniciando o cadastro de produtos...');

  const transaction = db.transaction((items) => {
    for (const item of items) {
      // Verificar se o produto já existe pelo nome para não duplicar se rodar duas vezes
      const exists = db.prepare('SELECT id FROM products WHERE name = ?').get(item.name);
      if (!exists) {
        insert.run(
          uuidv4(),
          item.barcode,
          item.name,
          item.cost,
          item.sell,
          item.stock,
          item.cat,
          now,
          now
        );
        count++;
      }
    }
  });

  transaction(products);
  console.log(`Sucesso! ${count} novos produtos foram cadastrados na distribuidora.`);
}

try {
  seed();
} catch (err) {
  console.error('Erro ao popular o banco:', err.message);
} finally {
  db.close();
}
