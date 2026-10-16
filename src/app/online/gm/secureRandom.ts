const randomWord = new Uint32Array(1);

export function secureRandom(): number {
  crypto.getRandomValues(randomWord);
  return randomWord[0]! / 2 ** 32;
}
