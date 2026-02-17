"""
Traffic Prediction Service using GRU Neural Network

This module provides traffic prediction functionality using a trained GRU model.
Falls back to heuristic predictions if the model is not available.
"""

import logging
import os
from pathlib import Path
from typing import Dict, Optional

logger = logging.getLogger(__name__)


class TrafficPredictor:
    """
    Traffic prediction service with graceful fallback.

    Loads a trained GRU model for traffic prediction. If the model files
    are not available, uses heuristic-based predictions instead.
    """

    def __init__(
        self,
        model_path: Optional[str] = None,
        scaler_path: Optional[str] = None,
    ):
        """
        Initialize the traffic predictor.

        Args:
            model_path: Path to the trained GRU model (.h5 file)
            scaler_path: Path to the feature scaler (.pkl file)
        """
        self.model = None
        self.scaler = None
        self.using_fallback = True

        # Default paths
        if not model_path:
            model_path = Path(__file__).parent / "models" / "gru_traffic_predictor.h5"
        if not scaler_path:
            scaler_path = Path(__file__).parent / "models" / "feature_scaler.pkl"

        # Try to load ML model
        try:
            # Import ML libraries only if model exists
            if Path(model_path).exists() and Path(scaler_path).exists():
                try:
                    from tensorflow import keras
                    import joblib

                    self.model = keras.models.load_model(str(model_path))
                    self.scaler = joblib.load(str(scaler_path))
                    self.using_fallback = False
                    logger.info("✓ Traffic prediction GRU model loaded successfully")
                except ImportError as exc:
                    logger.warning(
                        f"ML libraries not installed: {exc}. Using heuristic fallback."
                    )
                except Exception as exc:
                    logger.warning(
                        f"Failed to load ML model: {exc}. Using heuristic fallback."
                    )
            else:
                logger.info(
                    "ML model files not found. Using heuristic fallback. "
                    f"Expected: {model_path} and {scaler_path}"
                )
        except Exception as exc:
            logger.exception(f"Error during model initialization: {exc}")

    def predict_traffic(self, route_features: Dict) -> Dict:
        """
        Predict traffic level for a route.

        Args:
            route_features: Dictionary with keys:
                - distance_km: Route distance in kilometers
                - duration_min: Base duration in minutes
                - hour: Hour of day (0-23)
                - day_of_week: Day of week (0=Monday, 6=Sunday)
                - current_traffic_score: Current traffic score (0-10)

        Returns:
            Dictionary with keys:
                - predicted_level: str ("low", "medium", "high", "severe")
                - confidence: float (0-1)
                - estimated_delay_minutes: float
        """
        # If model not loaded, use fallback immediately
        if self.using_fallback or not self.model or not self.scaler:
            return self._fallback_prediction(route_features)

        try:
            # Try ML prediction
            import numpy as np

            # Extract and normalize features
            features = self._extract_features(route_features)
            scaled = self.scaler.transform([features])

            # Reshape for GRU input: (batch_size, timesteps, features)
            # For single prediction: (1, 1, num_features)
            reshaped = scaled.reshape((1, 1, -1))

            # Predict
            prediction = self.model.predict(reshaped, verbose=0)[0][0]

            # Convert to traffic level
            return self._interpret_prediction(prediction, route_features)

        except Exception as exc:
            logger.warning(f"ML prediction failed: {exc}. Using fallback.")
            return self._fallback_prediction(route_features)

    def _extract_features(self, route_features: Dict) -> list:
        """
        Extract feature vector from route features.

        Returns:
            List of numerical features for the model
        """
        return [
            route_features.get("distance_km", 0),
            route_features.get("duration_min", 0),
            route_features.get("hour", 12),
            route_features.get("day_of_week", 0),
            route_features.get("current_traffic_score", 5),
        ]

    def _interpret_prediction(
        self, raw_value: float, context: Dict
    ) -> Dict:
        """
        Convert model output to structured prediction.

        Args:
            raw_value: Model prediction (delay factor, 0-1 scale)
            context: Route features for context

        Returns:
            Structured prediction dictionary
        """
        # Assuming model outputs delay factor (0-1 scale)
        # 0 = no traffic, 1 = severe traffic

        if raw_value < 0.2:
            level = "low"
        elif raw_value < 0.5:
            level = "medium"
        elif raw_value < 0.8:
            level = "high"
        else:
            level = "severe"

        # Calculate estimated delay
        base_duration = context.get("duration_min", 10)
        delay = base_duration * raw_value * 0.5  # 50% max delay

        return {
            "predicted_level": level,
            "confidence": 0.8,  # High confidence for ML predictions
            "estimated_delay_minutes": round(delay, 1),
        }

    def _fallback_prediction(self, route_features: Dict) -> Dict:
        """
        Heuristic-based prediction when ML model unavailable.

        Uses time of day and current traffic score to estimate traffic levels.

        Args:
            route_features: Route features dictionary

        Returns:
            Prediction dictionary
        """
        traffic_score = route_features.get("current_traffic_score", 5.0)
        hour = route_features.get("hour", 12)
        day_of_week = route_features.get("day_of_week", 0)  # 0=Monday
        duration_min = route_features.get("duration_min", 10)

        # Rush hour adjustment (morning: 7-9, evening: 17-19)
        is_rush_hour = (7 <= hour <= 9) or (17 <= hour <= 19)
        is_weekend = day_of_week >= 5  # Saturday or Sunday

        # Adjust traffic score based on time
        adjusted_score = traffic_score

        if is_rush_hour and not is_weekend:
            adjusted_score += 2.0  # Increase traffic during rush hour
        elif is_weekend:
            adjusted_score -= 1.0  # Decrease traffic on weekends

        # Clamp to 0-10 range
        adjusted_score = max(0, min(10, adjusted_score))

        # Determine level
        if adjusted_score < 3:
            level = "low"
            delay_factor = 0.05
        elif adjusted_score < 6:
            level = "medium"
            delay_factor = 0.15
        elif adjusted_score < 8:
            level = "high"
            delay_factor = 0.30
        else:
            level = "severe"
            delay_factor = 0.50

        delay = duration_min * delay_factor

        return {
            "predicted_level": level,
            "confidence": 0.6,  # Lower confidence for heuristic
            "estimated_delay_minutes": round(delay, 1),
        }
