/**
 * Migration: Add endpoint URLs to project_api_keys
 *
 * Adds ws_endpoint and api_base_url columns to project_api_keys table.
 * These store the server's endpoint URLs per key, which is critical for
 * cloud deployments where WebSocket URLs differ per region/customer.
 *
 * This supports the simplified API key auth flow where reporters only
 * need QOP_API_KEY and the backend returns all connection details.
 */

exports.up = (pgm) => {
  pgm.addColumns('project_api_keys', {
    ws_endpoint: {
      type: 'varchar(500)',
      notNull: false,
    },
    api_base_url: {
      type: 'varchar(500)',
      notNull: false,
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('project_api_keys', ['ws_endpoint', 'api_base_url']);
};
