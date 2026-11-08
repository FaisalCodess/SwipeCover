import { useLayoutEffect, useRef } from 'react';
import { BallEngine } from './ballEngine.js';

function openCells(board) {
  const cells = [];
  board.forEach((row, rowIndex) => row.forEach((cell, colIndex) => {
    if (cell !== '|') cells.push([rowIndex, colIndex]);
  }));
  return cells;
}

// The ball and the sparks around it. React only renders the elements: all the motion runs in
// BallEngine, which writes the ball's position and shape straight to the DOM every frame and
// draws the sparks on the canvas, so a slide never waits on a re-render.
export default function BoardBall({ rows, cols, player, anim, bump, phase, board, mode }) {
  const canvasRef = useRef(null);
  const playerRef = useRef(null);
  const bodyRef = useRef(null);
  const engineRef = useRef(null);
  const handledAnim = useRef(null);
  // The latest props, for effects that should only run when one particular thing changes.
  const latest = useRef(null);
  latest.current = { rows, cols, player, board, mode };

  useLayoutEffect(() => {
    const current = latest.current;
    const engine = new BallEngine({
      layer: canvasRef.current.parentElement,
      canvas: canvasRef.current,
      player: playerRef.current,
      body: bodyRef.current,
      mode: current.mode,
      rows: current.rows,
      cols: current.cols,
    });
    engineRef.current = engine;
    engine.place(current.player.row, current.player.col, { pop: true });
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    engineRef.current?.setMode(mode);
  }, [mode]);

  // Before the animation below, so a new Swipe Rush board is measured before the ball lands on it.
  useLayoutEffect(() => {
    engineRef.current?.setBoard(rows, cols);
  }, [rows, cols]);

  useLayoutEffect(() => {
    // The first animation is the board the ball was just placed on.
    if (handledAnim.current === null) {
      handledAnim.current = anim.id;
      return;
    }
    if (handledAnim.current === anim.id) return;
    handledAnim.current = anim.id;
    engineRef.current?.handle(anim, latest.current.player);
  }, [anim]);

  useLayoutEffect(() => {
    if (bump) engineRef.current?.bump(bump.direction);
  }, [bump]);

  useLayoutEffect(() => {
    if (phase === 'celebrating') engineRef.current?.celebrate(openCells(latest.current.board), true);
    else if (phase === 'advancing') engineRef.current?.celebrate(null, false);
  }, [phase]);

  return (
    <>
      <canvas ref={canvasRef} className="board-fx" aria-hidden="true" />
      <div ref={playerRef} className="board-player" aria-hidden="true">
        <div ref={bodyRef} className="board-player-body">
          <span className="board-player-ball" />
        </div>
      </div>
    </>
  );
}
