-- Seed: 14 hotel rooms (101-114) + sample recreation-area units

INSERT INTO units (type, name, category, capacity) VALUES
  ('room', '101', 'standard', 2),
  ('room', '102', 'standard', 2),
  ('room', '103', 'standard', 2),
  ('room', '104', 'standard', 2),
  ('room', '105', 'standard', 3),
  ('room', '106', 'standard', 3),
  ('room', '107', 'comfort',  2),
  ('room', '108', 'comfort',  2),
  ('room', '109', 'comfort',  3),
  ('room', '110', 'comfort',  3),
  ('room', '111', 'family',   4),
  ('room', '112', 'family',   4),
  ('room', '113', 'lux',      2),
  ('room', '114', 'lux',      4);

INSERT INTO units (type, name, category, capacity) VALUES
  ('sunbed', 'Топчан 1', 'poolside', 4),
  ('sunbed', 'Топчан 2', 'poolside', 4),
  ('sunbed', 'Топчан 3', 'poolside', 4),
  ('sunbed', 'Топчан 4', 'garden',   4),
  ('sunbed', 'Топчан 5', 'garden',   4),
  ('sunbed', 'Топчан 6', 'garden',   4);

INSERT INTO units (type, name, category, capacity) VALUES
  ('gazebo', 'Беседка 1', 'standard', 8),
  ('gazebo', 'Беседка 2', 'standard', 8),
  ('gazebo', 'Беседка 3', 'standard', 10),
  ('gazebo', 'Беседка 4', 'standard', 10);

INSERT INTO units (type, name, category, capacity) VALUES
  ('vip_gazebo', 'VIP-беседка 1', 'vip', 12),
  ('vip_gazebo', 'VIP-беседка 2', 'vip', 16);