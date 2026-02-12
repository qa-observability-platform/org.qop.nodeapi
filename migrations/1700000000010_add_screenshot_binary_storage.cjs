/* Add binary data column for storing screenshots directly in database */

exports.shorthands = undefined;

/**
 * Up: Add image_data column for binary screenshot storage
 */
exports.up = (pgm) => {
  // Add bytea column for storing image binary data
  pgm.addColumn('screenshots', {
    image_data: {
      type: 'bytea',
      notNull: false,
      comment: 'Binary image data (optional, alternative to file storage)'
    }
  });

  // Make file_path nullable since we might store in DB instead
  pgm.alterColumn('screenshots', 'file_path', {
    notNull: false
  });

  // Add check constraint to ensure either file_path or image_data exists
  pgm.addConstraint('screenshots', 'screenshots_storage_check', {
    check: '(file_path IS NOT NULL) OR (image_data IS NOT NULL)'
  });
};

/**
 * Down: Remove binary storage column
 */
exports.down = (pgm) => {
  pgm.dropConstraint('screenshots', 'screenshots_storage_check');
  pgm.dropColumn('screenshots', 'image_data');
  pgm.alterColumn('screenshots', 'file_path', {
    notNull: true
  });
};
