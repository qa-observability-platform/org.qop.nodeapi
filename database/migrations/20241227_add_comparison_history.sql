-- Migration: Add Comparison History Table
-- Purpose: Track user comparisons, allow revisiting, bookmarking, and adding notes
-- Author: QOP Team
-- Date: 2024-12-27

-- ========================================
-- comparison_history Table
-- ========================================

CREATE TABLE IF NOT EXISTS comparison_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Comparison Details
    current_run_id UUID NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
    compare_run_id UUID NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,

    -- Metadata
    comparison_name VARCHAR(255), -- User-defined name (optional)
    is_bookmarked BOOLEAN DEFAULT FALSE,
    notes TEXT, -- User notes about this comparison

    -- Cached Results (for fast retrieval)
    comparison_result JSONB, -- Store full comparison result
    risk_score_data JSONB, -- Store risk score separately for quick access

    -- Audit Fields
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_viewed_at TIMESTAMP,
    view_count INTEGER DEFAULT 0,

    -- Indexes for fast lookup
    CONSTRAINT unique_comparison UNIQUE(current_run_id, compare_run_id)
);

-- Indexes
CREATE INDEX idx_comparison_history_current_run ON comparison_history(current_run_id);
CREATE INDEX idx_comparison_history_compare_run ON comparison_history(compare_run_id);
CREATE INDEX idx_comparison_history_application ON comparison_history(application_id);
CREATE INDEX idx_comparison_history_bookmarked ON comparison_history(is_bookmarked) WHERE is_bookmarked = TRUE;
CREATE INDEX idx_comparison_history_created_at ON comparison_history(created_at DESC);

-- ========================================
-- comparison_tags Table (Many-to-Many)
-- ========================================

CREATE TABLE IF NOT EXISTS comparison_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL UNIQUE,
    color VARCHAR(20) DEFAULT 'blue', -- For UI display
    description TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comparison_history_tags (
    comparison_id UUID NOT NULL REFERENCES comparison_history(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES comparison_tags(id) ON DELETE CASCADE,
    PRIMARY KEY (comparison_id, tag_id)
);

-- Pre-populate common tags
INSERT INTO comparison_tags (name, color, description) VALUES
    ('regression', 'red', 'Significant quality regression'),
    ('investigation', 'yellow', 'Requires further investigation'),
    ('release-blocker', 'red', 'Blocks release to production'),
    ('performance', 'orange', 'Performance-related issues'),
    ('flaky-tests', 'purple', 'Flakiness investigation'),
    ('resolved', 'green', 'Issue has been resolved')
ON CONFLICT (name) DO NOTHING;

-- ========================================
-- Triggers
-- ========================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_comparison_history_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_comparison_history_timestamp
    BEFORE UPDATE ON comparison_history
    FOR EACH ROW
    EXECUTE FUNCTION update_comparison_history_timestamp();

-- ========================================
-- Helper Functions
-- ========================================

-- Function to increment view count
CREATE OR REPLACE FUNCTION increment_comparison_view_count(comparison_id_param UUID)
RETURNS void AS $$
BEGIN
    UPDATE comparison_history
    SET
        view_count = view_count + 1,
        last_viewed_at = NOW()
    WHERE id = comparison_id_param;
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- Comments
-- ========================================

COMMENT ON TABLE comparison_history IS 'Stores history of test run comparisons with bookmarking and notes';
COMMENT ON COLUMN comparison_history.comparison_result IS 'Full JSONB cache of comparison result for fast retrieval';
COMMENT ON COLUMN comparison_history.risk_score_data IS 'Extracted risk score data for dashboard display';
COMMENT ON COLUMN comparison_history.is_bookmarked IS 'Flag for important comparisons';
COMMENT ON COLUMN comparison_history.notes IS 'User notes or context about this comparison';

-- ========================================
-- Sample Query Examples
-- ========================================

-- Get recent comparisons for an application
-- SELECT * FROM comparison_history WHERE application_id = 'xxx' ORDER BY created_at DESC LIMIT 10;

-- Get bookmarked comparisons
-- SELECT * FROM comparison_history WHERE is_bookmarked = TRUE ORDER BY created_at DESC;

-- Get comparison with tags
-- SELECT ch.*, array_agg(ct.name) as tags
-- FROM comparison_history ch
-- LEFT JOIN comparison_history_tags cht ON ch.id = cht.comparison_id
-- LEFT JOIN comparison_tags ct ON cht.tag_id = ct.id
-- GROUP BY ch.id;

-- Check if comparison already exists
-- SELECT id FROM comparison_history WHERE current_run_id = 'xxx' AND compare_run_id = 'yyy';
