import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchToys, scoreToy, stem, distance } from '../assets/js/search.js';

const T = (name, category, extra = {}) => ({ id: name, name, category, code: extra.code || 'AS-0001', audience: 'neutral', condition: 'used', ...extra });
const toys = [
  T('Teddy Bear', 'Soft Toys', { code: 'AS-0012' }),
  T('Pink Bunny Plushie', 'Soft Toys'),
  T('Red Toy Car', 'Cars & Vehicles', { brand: 'Hot Wheels' }),
  T('Yellow Dump Truck', 'Cars & Vehicles'),
  T('Toy Train Set', 'Cars & Vehicles'),
  T('Dinosaur Toy', 'Action Figures'),
  T('Card Game', 'Puzzles & Games'),
  T('Barbie Fashion Doll', 'Dolls & Accessories', { audience: 'girls' }),
  T('Wooden Blocks', 'Building & Blocks'),
  T('Football', 'Outdoor & Sports'),
  T('Wall Clock Puzzle', 'Learning Toys'),
];
const names = (q) => searchToys(toys, q).toys.map((t) => t.name);

test('plurals and accents are the same word', () => {
  assert.equal(stem('Cars'), 'car');
  assert.equal(stem('puppies'), 'puppy');
  assert.equal(stem('boxes'), 'box');
  assert.equal(stem('plushie'), stem('plushies'));
  assert.equal(stem('bus'), 'bus');
  assert.equal(stem('0012'), '12');
  assert.equal(distance('dinasour', 'dinosaur'), 2);
  assert.equal(distance('teh', 'the'), 1);
});

test('exact names come first', () => {
  assert.equal(names('teddy bear')[0], 'Teddy Bear');
  assert.equal(names('cars')[0], 'Red Toy Car');
});

test('spelling slips still find the toy', () => {
  assert.equal(names('dinasour')[0], 'Dinosaur Toy');
  assert.equal(names('teddie')[0], 'Teddy Bear');
  assert.equal(names('barbi')[0], 'Barbie Fashion Doll');
  assert.equal(names('fotball')[0], 'Football');
  assert.ok(names('trian').includes('Toy Train Set'));
});

test('start of a word is enough', () => {
  assert.equal(names('dino')[0], 'Dinosaur Toy');
  assert.equal(names('plush')[0], 'Pink Bunny Plushie');
});

test('related words find related toys, ranked after exact ones', () => {
  const v = names('vehicle');
  for (const n of ['Red Toy Car', 'Yellow Dump Truck', 'Toy Train Set']) assert.ok(v.includes(n), n);
  const car = names('car');
  assert.equal(car[0], 'Red Toy Car');
  assert.ok(car.includes('Yellow Dump Truck'));
  assert.ok(!car.includes('Card Game'), 'car is not card');
  assert.ok(names('lorry').includes('Yellow Dump Truck'));
  assert.ok(names('teddy').includes('Pink Bunny Plushie'));
  assert.equal(names('teddy')[0], 'Teddy Bear');
  assert.ok(names('soft toy').includes('Teddy Bear'));
  assert.ok(names('lego').includes('Wooden Blocks'));
  assert.ok(names('soccer ball').includes('Football'));
  assert.ok(names('animals').includes('Dinosaur Toy'));
});

test('short words do not match look-alikes', () => {
  assert.ok(!names('ball').includes('Wall Clock Puzzle'));
});

test('brand, code and type are searched', () => {
  assert.equal(names('hot wheels')[0], 'Red Toy Car');
  assert.equal(names('AS-0012')[0], 'Teddy Bear');
  assert.equal(names('12')[0], 'Teddy Bear');
  assert.ok(names('girls doll').includes('Barbie Fashion Doll'));
});

test('no toy has every word: nearest ones instead', () => {
  const r = searchToys(toys, 'purple truck');
  assert.equal(r.close, true);
  assert.equal(r.toys[0].name, 'Yellow Dump Truck');
});

test('nothing like it at all', () => {
  assert.deepEqual(names('xylophone'), []);
  assert.equal(scoreToy(toys[0], ''), 1);
});
