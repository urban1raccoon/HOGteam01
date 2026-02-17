"""
GRU Traffic Prediction Model Training Script

This script trains a GRU neural network for traffic prediction.
Based on the architecture from the existing Jupyter notebook.

For now, this creates a simplified model that can be trained with synthetic data.
In production, replace with real historical traffic data.
"""


from pathlib import Path


def create_synthetic_training_data(num_samples=1000):
    """
    Create synthetic training data for traffic prediction.

    In production, replace this with real historical data from:
    - 2GIS traffic logs
    - City traffic sensors
    - Historical route times

    Returns:
        X: Features array (num_samples, num_features)
        y: Target array (num_samples,) - delay factor (0-1)
    """
    import numpy as np

    np.random.seed(42)

    # Features: [distance_km, duration_min, hour, day_of_week, traffic_score]
    distance_km = np.random.uniform(1, 30, num_samples)
    duration_min = distance_km * np.random.uniform(1.5, 3.0, num_samples)
    hour = np.random.randint(0, 24, num_samples)
    day_of_week = np.random.randint(0, 7, num_samples)
    traffic_score = np.random.uniform(0, 10, num_samples)

    X = np.column_stack([distance_km, duration_min, hour, day_of_week, traffic_score])

    # Target: delay factor (0-1) based on traffic score and time
    # Higher traffic score → higher delay
    # Rush hours → higher delay
    is_rush = ((hour >= 7) & (hour <= 9)) | ((hour >= 17) & (hour <= 19))
    is_weekday = day_of_week < 5

    base_delay = traffic_score / 10  # 0-1 scale
    rush_bonus = np.where(is_rush & is_weekday, 0.2, 0.0)

    y = np.clip(base_delay + rush_bonus + np.random.normal(0, 0.1, num_samples), 0, 1)

    return X, y


def build_gru_model(input_shape):
    """
    Build GRU model architecture.

    Based on the 5-layer stacked GRU from the Jupyter notebook:
    150 → 150 → 50 → 50 → 50 units

    Args:
        input_shape: Tuple of (timesteps, features)

    Returns:
        Compiled Keras model
    """
    from tensorflow import keras
    from tensorflow.keras import layers

    model = keras.Sequential([
        # Input layer
        layers.Input(shape=input_shape),

        # Stacked GRU layers (simplified from notebook)
        layers.GRU(150, return_sequences=True, activation='tanh', dropout=0.2),
        layers.GRU(150, return_sequences=True, activation='tanh', dropout=0.2),
        layers.GRU(50, return_sequences=True, activation='tanh', dropout=0.2),
        layers.GRU(50, return_sequences=True, activation='tanh', dropout=0.2),
        layers.GRU(50, activation='tanh', dropout=0.2),

        # Output layer
        layers.Dense(1, activation='sigmoid'),  # Output delay factor (0-1)
    ])

    # Compile model
    model.compile(
        optimizer='adam',
        loss='mse',
        metrics=['mae'],
    )

    return model


def train_and_save_model(output_dir=None):
    """
    Train GRU model and save it along with the feature scaler.

    Args:
        output_dir: Directory to save model files (default: ml/models/)
    """
    try:
        from sklearn.preprocessing import StandardScaler
        import joblib
        import numpy as np

        # Set default output directory
        if not output_dir:
            output_dir = Path(__file__).parent / "models"

        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        print("Generating synthetic training data...")
        X, y = create_synthetic_training_data(num_samples=5000)

        # Split into train/test
        split_idx = int(0.9 * len(X))
        X_train, X_test = X[:split_idx], X[split_idx:]
        y_train, y_test = y[:split_idx], y[split_idx:]

        # Scale features
        print("Scaling features...")
        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled = scaler.transform(X_test)

        # Reshape for GRU: (samples, timesteps, features)
        # For simplicity, using single timestep
        X_train_reshaped = X_train_scaled.reshape((-1, 1, X_train_scaled.shape[1]))
        X_test_reshaped = X_test_scaled.reshape((-1, 1, X_test_scaled.shape[1]))

        # Build model
        print("Building GRU model...")
        model = build_gru_model(input_shape=(1, X_train_scaled.shape[1]))

        print("\nModel summary:")
        model.summary()

        # Train model
        print("\nTraining model...")
        history = model.fit(
            X_train_reshaped,
            y_train,
            validation_data=(X_test_reshaped, y_test),
            epochs=20,
            batch_size=32,
            verbose=1,
        )

        # Evaluate
        print("\nEvaluating model...")
        test_loss, test_mae = model.evaluate(X_test_reshaped, y_test, verbose=0)
        print(f"Test Loss: {test_loss:.4f}")
        print(f"Test MAE: {test_mae:.4f}")

        # Save model and scaler
        model_path = output_dir / "gru_traffic_predictor.h5"
        scaler_path = output_dir / "feature_scaler.pkl"

        print(f"\nSaving model to {model_path}...")
        model.save(str(model_path))

        print(f"Saving scaler to {scaler_path}...")
        joblib.dump(scaler, str(scaler_path))

        print("\n✓ Training complete!")
        print(f"✓ Model saved: {model_path}")
        print(f"✓ Scaler saved: {scaler_path}")

        return model, scaler

    except ImportError as exc:
        print(f"\n✗ Error: Required ML libraries not installed: {exc}")
        print("\nInstall dependencies with:")
        print("  pip install tensorflow keras scikit-learn joblib")
        return None, None
    except Exception as exc:
        print(f"\n✗ Training failed: {exc}")
        raise


if __name__ == "__main__":
    print("=" * 60)
    print("GRU Traffic Prediction Model Training")
    print("=" * 60)
    print()
    print("NOTE: This script uses synthetic data for demonstration.")
    print("For production, replace with real historical traffic data.")
    print()

    train_and_save_model()
