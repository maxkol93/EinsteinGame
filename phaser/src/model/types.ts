// A clue. Two shapes, matching the pygame model:
//   [a, '^',   b]  — a is in the same column as b
//   [a, '...', b]  — a is somewhere to the left of b
//   [a, '<->', b]  — a and b are in neighbouring columns
//   [a, 'define', col] — a sits in column `col` (a revealed starter cell)
//   [a, b, c]      — three values fill three consecutive columns in this order
//                    (readable left-to-right or right-to-left); all numbers.
// Cell values encode row+value as `(row+1)*10 + value`, value in 1..size.
export type Rule = Array<number | string>;
