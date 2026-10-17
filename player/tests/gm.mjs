    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { Application, Graphics } from 'pixi.js';
    import { PendingPathQueue } from '/src/app/online/gm/paths/PendingPathQueue.tsx';
    import { PendingPathOverlay } from '/src/app/online/gm/paths/PendingPathOverlay.ts';
    import { resolveMeasurementSettings } from '/src/app/grid/measurementFormat.ts';
    import { installDomHost } from '/src/app/host/dom.ts';
    import { destroyTree } from '/src/app/pixi/utils/destroyTree.ts';
    import { RenderScheduler, requestRender } from '/src/app/pixi/RenderScheduler.ts';
    import '/player/src/theme.scss';
    import './gm.scss';

    installDomHost({
      createCanvas(doc = document, size) {
        const canvas = doc.createElement('canvas');
        if (size) {
          canvas.width = size.width;
          canvas.height = size.height;
        }
        return canvas;
      },
      createDiv(parent, className) {
        const div = parent.ownerDocument.createElement('div');
        div.className = className;
        parent.append(div);
        return div;
      },
      ownerWindow(node) {
        return node.ownerDocument?.defaultView ?? window;
      },
      activeDocument() {
        return document;
      },
    });

    const errors = document.querySelector('#errors');
    const command = async (data) => {
      const response = await fetch('/__smoke/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    };
    const commandSync = (data) => {
      const request = new XMLHttpRequest();
      request.open('POST', '/__smoke/command', false);
      request.setRequestHeader('Content-Type', 'application/json');
      request.send(JSON.stringify(data));
      if (request.status !== 200) throw new Error(request.responseText);
      return JSON.parse(request.responseText);
    };
    let state = null;
    let paths = [];
    const listeners = new Set();
    const facade = {
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot() {
        return paths;
      },
      get editingRequest() {
        return state?.editingRequest ?? null;
      },
      approve(request) {
        void command({ type: 'path-approve', request });
      },
      cancel(request) {
        void command({ type: 'path-cancel', request });
      },
      approveAll() {
        void command({ type: 'path-approve-all' });
      },
      cancelAll() {
        void command({ type: 'path-cancel-all' });
      },
      beginEdit(request) {
        void command({ type: 'path-edit', request });
      },
      endEdit(commit) {
        void command({ type: 'path-done', commit });
      },
      editPoint(request, index, point) {
        return commandSync({ type: 'path-point', request, index, ...point });
      },
      insertPoint(request, index, point) {
        return commandSync({ type: 'path-insert', request, index, ...point });
      },
      deletePoint(request, index) {
        return commandSync({ type: 'path-delete', request, index });
      },
    };
    const app = new Application();
    await app.init({ width: 700, height: 700, background: '#222222', preference: 'webgl' });
    app.canvas.className = 'atlas-gm__pixi-canvas';
    const map = document.querySelector('#map');
    map.append(app.canvas);
    app.stage.scale.set(0.5);
    const scheduler = new RenderScheduler(app);
    const floor = new Graphics();
    floor.rect(0, 0, 700, 1400).fill('#bea582').rect(700, 0, 700, 1400).fill('#82aabe');
    app.stage.addChild(floor);
    const walls = new Graphics();
    app.stage.addChild(walls);
    const overlay = new PendingPathOverlay(facade, {
      window,
      worldPoint(event) {
        const rect = app.canvas.getBoundingClientRect();
        return {
          x: ((event.clientX - rect.left) / rect.width) * 1400,
          y: ((event.clientY - rect.top) / rect.height) * 1400,
        };
      },
      zoom() {
        const rect = app.canvas.getBoundingClientRect();
        return 0.5 * rect.width / 700;
      },
      colour() {
        return 0xa41e22;
      },
      gesture(active) {
        app.canvas.dataset.gesture = String(active);
      },
      requestRender() {
        requestRender(app);
      },
    });
    app.stage.addChild(overlay.layer);
    const root = createRoot(document.querySelector('#queue'));
    const permissionKeys = ['approval', 'perPlayerVision', 'playerConditions', 'playerDoors'];
    for (const key of permissionKeys) {
      const input = document.querySelector(`[data-permission="${key}"]`);
      input.onchange = () => void command({ type: 'permission', key, value: input.checked });
    }
    for (const type of ['undo', 'redo', 'restart']) {
      document.querySelector(`#${type}`).onclick = () => void command({ type });
    }
    function appendEmpty(parent, message) {
      const empty = document.createElement('p');
      empty.className = 'atlas-gm__empty';
      empty.textContent = message;
      parent.append(empty);
    }
    function makeButton(label, action, primary = false) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = primary ? 'atlas-gm__button--primary' : '';
      button.textContent = label;
      button.onclick = action;
      return button;
    }
    function renderQueue() {
      root.render(React.createElement(
        React.Fragment,
        null,
        paths.length === 0 ? React.createElement('p', { className: 'atlas-gm__empty' }, 'No movement proposals are waiting.') : null,
        React.createElement(PendingPathQueue, {
          paths: facade,
          grid: state.state.grid,
          measurement: resolveMeasurementSettings(undefined, state.state.grid),
          labels: { heading: 'Pending paths', approve: 'Approve', approveAll: 'Approve all', cancelAll: 'Cancel all' },
          describe(path) {
            return `${path.token.name ?? path.tokenId}, ${state.ownership.players[path.from]?.name ?? path.from}`;
          },
        }),
      ));
    }
    const stream = new EventSource('/__smoke/state');
    stream.onmessage = (event) => {
      try {
        state = JSON.parse(event.data);
        paths = state.paths;
        const status = document.querySelector('#status');
        status.textContent = state.status;
        status.dataset.state = state.status;
        const waiting = document.querySelector('#waiting');
        waiting.replaceChildren();
        document.querySelector('#waiting-count').textContent = String(state.gate.waiting.length);
        for (const person of state.gate.waiting) {
          const row = document.createElement('div');
          row.className = 'atlas-gm__record';
          const name = document.createElement('span');
          name.className = 'atlas-gm__record-name';
          name.textContent = person.name;
          const actions = document.createElement('div');
          actions.className = 'atlas-gm__record-actions';
          for (const type of ['admit', 'decline']) {
            const button = makeButton(
              type === 'admit' ? `Admit ${person.name}` : `Decline ${person.name}`,
              () => void command({ type, id: person.id }),
              type === 'admit',
            );
            button.disabled = person.armed !== true;
            actions.append(button);
          }
          row.append(name, actions);
          waiting.append(row);
        }
        if (state.gate.waiting.length === 0) appendEmpty(waiting, 'No players are waiting for admission.');
        const claims = document.querySelector('#claims');
        claims.replaceChildren();
        document.querySelector('#claims-count').textContent = String(state.claims.length);
        for (const claim of state.claims) {
          const row = document.createElement('div');
          row.className = 'atlas-gm__record';
          const detail = document.createElement('p');
          detail.className = 'atlas-gm__record-detail';
          detail.textContent = `${claim.playerName} requests ${claim.tokenName}`;
          const actions = document.createElement('div');
          actions.className = 'atlas-gm__record-actions';
          for (const action of ['accept', 'decline']) {
            const button = makeButton(
              `${action === 'accept' ? 'Accept' : 'Decline'} ${claim.tokenName}`,
              () => void command({ type: `claim-${action}`, from: claim.from, request: claim.request }),
              action === 'accept',
            );
            actions.append(button);
          }
          row.append(detail, actions);
          claims.append(row);
        }
        if (state.claims.length === 0) appendEmpty(claims, 'No character requests are waiting.');
        const people = document.querySelector('#people');
        people.replaceChildren();
        const players = Object.entries(state.ownership.players);
        for (const [id, person] of players) {
          const row = document.createElement('div');
          row.className = 'atlas-gm__record';
          const name = document.createElement('span');
          name.className = 'atlas-gm__record-name';
          name.textContent = person.name;
          const actions = document.createElement('div');
          actions.className = 'atlas-gm__record-actions';
          for (const token of ['alice', 'bob', 'unclaimed']) {
            actions.append(makeButton(
              `Give ${token} to ${person.name}`,
              () => void command({ type: 'give', token, player: id }),
            ));
          }
          row.append(name, actions);
          people.append(row);
        }
        if (players.length === 0) appendEmpty(people, 'Admit a player to assign a character.');
        for (const key of permissionKeys) {
          document.querySelector(`[data-permission="${key}"]`).checked =
            state.ownership.permissions?.['atlas-vtt/collections/Smoke/scenes/Two rooms.atlasmap']?.[key] === true;
        }
        walls.clear();
        for (const wall of Object.values(state.state.objects.walls)) {
          walls
            .moveTo(wall.p1.x, wall.p1.y)
            .lineTo(wall.p2.x, wall.p2.y)
            .stroke({ width: 8, color: wall.type === 'door' ? 0xf0ba50 : wall.type === 'secret-door' ? 0x8b5fc0 : 0x111111 });
        }
        for (const listener of listeners) listener();
        renderQueue();
        requestRender(app);
      } catch (error) {
        errors.textContent = String(error);
      }
    };
    stream.onerror = () => {
      errors.textContent = 'GM fixture state stream disconnected';
    };
    const connection = await fetch('/__smoke/table').then((response) => response.json());
    document.querySelector('#join').href = `/player/index.html#${connection.table}`;
    document.querySelector('#join-code').textContent = connection.code;
    window.addEventListener('pagehide', () => {
      stream.close();
      root.unmount();
      overlay.destroy();
      scheduler.destroy();
      destroyTree(app.stage);
      app.destroy(true);
    }, { once: true });
